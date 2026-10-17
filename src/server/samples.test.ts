import path from "node:path";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { documents } from "@/db/schema";
import type { InvoiceData } from "@/lib/invoice";
import { SAMPLE_RUN, SAMPLES } from "@/lib/samples";
import { createTestDb, type TestDb } from "@/test/db";
import { memoryStorage } from "@/test/fixtures";
import { currentInvoice, extractedInvoice, getDocument } from "./documents";
import { spentToday, uploadsToday } from "./limits";
import { approveDocument } from "./review";
import { copySample, listSamples } from "./samples";
import { seedSamples } from "./seed";

vi.mock("server-only", () => ({}));

const testSet = path.join(process.cwd(), "test-set");
const responses = path.join(process.cwd(), "docs", "measurements", "responses", SAMPLE_RUN);
const truth = (id: string): InvoiceData => JSON.parse(readFileSync(path.join(testSet, "truth", `${id}.json`), "utf8"));

let db: TestDb;
let close: () => Promise<void>;
const storage = memoryStorage();
beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = () => test.client.close();
  await seedSamples(db, storage.storage, { testSet, responses });
}, 60_000);
afterAll(() => close());

describe("seeded samples", () => {
  it("are public demo documents, read by the app's own steps from the saved answers", async () => {
    const samples = await listSamples(db);
    expect(samples.map((s) => s.doc.id)).toEqual(SAMPLES.map((s) => `sample-${s.invoice.slice(4)}`));
    expect(samples.every((s) => s.doc.source === "demo" && s.doc.workspaceId === null)).toBe(true);
    // The two that don't add up wait for review; the rest were approved automatically.
    expect(samples.filter((s) => s.doc.status === "needs_review").map((s) => s.sample.invoice)).toEqual(["inv-056", "inv-058"]);
    expect(samples[0]).toMatchObject({ supplier: "Cobalt Peak Supplies Inc.", currency: "USD", total: "4040.05" });
    expect(storage.files.has("samples/inv-049/inv-049.jpg")).toBe(true);

    const view = (await getDocument(db, "sample-001", null))!;
    expect(extractedInvoice(view.fields, view.lineItems)).toEqual(truth("inv-001"));
    expect(view.extractions[0]).toMatchObject({ model: "claude-sonnet-5-5", promptVersion: "v1", accepted: true, rawJson: { savedAnswerFrom: SAMPLE_RUN } });
  });

  it("are kept when seeded again", async () => {
    expect(await seedSamples(db, storage.storage, { testSet, responses })).toEqual({ added: [], kept: SAMPLES.map((s) => `sample-${s.invoice.slice(4)}`) });
  });
});

describe("copySample", () => {
  it("gives a browser its own copy to review, without touching the sample", async () => {
    const copy = (await copySample(db, { workspaceId: "ws-1", id: "sample-056" }))!;
    expect(copy).not.toBe("sample-056");
    expect(await copySample(db, { workspaceId: "ws-1", id: "sample-056" })).toBe(copy);
    expect(await getDocument(db, copy, "ws-2")).toBeNull();

    const view = (await getDocument(db, copy, "ws-1"))!;
    expect(view.doc).toMatchObject({ status: "needs_review", workspaceId: "ws-1", copiedFrom: "sample-056", source: "upload" });
    const sample = (await getDocument(db, "sample-056", null))!;
    expect(view.fields.map((f) => [f.name, f.value, f.confidence])).toEqual(sample.fields.map((f) => [f.name, f.value, f.confidence]));
    expect(view.lineItems).toHaveLength(sample.lineItems.length);

    const data = currentInvoice(view.fields, view.lineItems);
    expect(await approveDocument(db, { workspaceId: "ws-1", id: copy, input: { data: { ...data, total: "6782.62" }, acceptFailingRules: false } })).toEqual({ ok: true });
    const [after] = await db.select().from(documents).where(eq(documents.id, "sample-056"));
    expect(after.status).toBe("needs_review");
    // A new copy once the first is approved.
    expect(await copySample(db, { workspaceId: "ws-1", id: "sample-056" })).not.toBe(copy);
  });

  it("only copies samples that wait for review, and counts toward no cap", async () => {
    expect(await copySample(db, { workspaceId: "ws-1", id: "sample-001" })).toBeNull();
    expect(await copySample(db, { workspaceId: "ws-1", id: "not-a-sample" })).toBeNull();
    expect(await uploadsToday(db)).toBe(0);
    expect(await spentToday(db)).toBe(0);
  });
});
