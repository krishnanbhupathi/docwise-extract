import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents } from "@/db/schema";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { answer, invoice, invoiceText, memoryStorage, modelReturning, pdf, textPdf } from "@/test/fixtures";
import { approveInvoice, invoiceJson, listInvoices, listQuery } from "./api";
import { getDocument, processDocument, receiveUpload, sniffMediaType } from "./documents";

vi.mock("server-only", () => ({}));

let db: TestDb;
let close: () => Promise<void>;
beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = () => test.client.close();
});
afterAll(() => close());
beforeEach(() => resetTestDb(db));

const ORIGIN = "https://docwise.test";

/** An invoice sent through the API and read by the model. */
async function sentAndRead(body: object, workspaceId = "ws-1") {
  const storage = memoryStorage();
  const received = await receiveUpload(db, storage.storage, { workspaceId, fileName: "inv.pdf", data: await textPdf(invoiceText) });
  if (!received.ok) throw new Error(received.error);
  await processDocument(db, storage.storage, modelReturning(answer(body, { model: "claude-sonnet-5-5" })), received.id);
  return received.id;
}

describe("receiveUpload", () => {
  it("goes by the file's bytes, stores it and queues it", async () => {
    const storage = memoryStorage();
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer());
    expect(sniffMediaType(png)).toBe("image/png");
    const result = await receiveUpload(db, storage.storage, { workspaceId: "ws-1", fileName: "scan.pdf", data: png });
    if (!result.ok) throw new Error(result.error);
    const [doc] = await db.select().from(documents).where(eq(documents.id, result.id));
    expect(doc).toMatchObject({ status: "queued", mediaType: "image/png", fileName: "scan.pdf", fileKey: `uploads/${result.id}/scan.png`, workspaceId: "ws-1", pages: 1 });
    expect(storage.files.get(doc.fileKey)).toEqual(png);
  });

  it("refuses what it can't read, before storing anything", async () => {
    const storage = memoryStorage();
    const send = (data: Uint8Array) => receiveUpload(db, storage.storage, { workspaceId: "ws-1", fileName: "x", data });
    expect(await send(new Uint8Array())).toMatchObject({ ok: false, status: 400, code: "empty_file" });
    expect(await send(new TextEncoder().encode("hello"))).toMatchObject({ ok: false, status: 415, code: "unsupported_type" });
    expect(await send(new Uint8Array(4 * 1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413, code: "file_too_large" });
    expect(await send(await pdf(6))).toMatchObject({ ok: false, status: 422, code: "too_many_pages" });
    expect(await send(new TextEncoder().encode("%PDF-1.7 broken"))).toMatchObject({ ok: false, status: 422, code: "unreadable_pdf" });
    expect(storage.files.size).toBe(0);
    expect(await db.select().from(documents)).toEqual([]);
  });

  it("shares the demo's daily caps", async () => {
    const storage = memoryStorage();
    const result = await receiveUpload(db, storage.storage, { workspaceId: "ws-1", fileName: "x.pdf", data: await pdf(1) }, { dailyLimit: 0 });
    expect(result).toMatchObject({ ok: false, status: 429, code: "daily_cap_reached" });
  });
});

describe("invoiceJson", () => {
  it("returns the values, confidence, failing checks and cost of a read invoice", async () => {
    const id = await sentAndRead({ ...invoice, total: "1550.00" });
    const json = invoiceJson((await getDocument(db, id, "ws-1"))!, ORIGIN);
    expect(json).toMatchObject({
      id,
      status: "needs_review",
      sample: false,
      invoice: { supplier_name: "Copperleaf Studio Ltd", total: "1550.00" },
      corrected_fields: [],
      confidence: { supplier_name: { level: "high", reasons: [] }, total: { level: "low" } },
      checks: [{ rule: "total_mismatch", fields: ["subtotal", "tax", "total"] }],
      extraction: { model: "claude-sonnet-5-5", prompt_version: "v1", attempts: 1, tokens_in: 2400, tokens_out: 600, cost_usd: 0.0108 },
      links: { self: `${ORIGIN}/api/v1/invoices/${id}`, review: `${ORIGIN}/documents/${id}` },
    });
  });
});

describe("listInvoices", () => {
  it("lists this workspace's invoices, newest first, optionally by status", async () => {
    const reviewed = await sentAndRead({ ...invoice, total: "1550.00" });
    const approved = await sentAndRead(invoice);
    await sentAndRead(invoice, "ws-2");
    const all = await listInvoices(db, "ws-1", listQuery.parse({}), ORIGIN);
    expect(all.map((i) => i.id)).toEqual([approved, reviewed]);
    expect((await listInvoices(db, "ws-1", listQuery.parse({ status: "needs_review" }), ORIGIN)).map((i) => i.id)).toEqual([reviewed]);
    expect(listQuery.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("approveInvoice", () => {
  it("applies partial corrections and approves", async () => {
    const id = await sentAndRead({ ...invoice, total: "1550.00" });
    const result = await approveInvoice(db, { workspaceId: "ws-1", id, body: { invoice: { total: "1500.00" } } });
    if (!result.ok) throw new Error(result.error.message);
    expect(invoiceJson(result.view, ORIGIN)).toMatchObject({ status: "approved", approval: "review", corrected_fields: ["total"], invoice: { total: "1500.00", subtotal: "1250.00" }, checks: [] });
  });

  it("says why it can't approve", async () => {
    const id = await sentAndRead({ ...invoice, total: "1550.00" });
    expect(await approveInvoice(db, { workspaceId: "ws-2", id, body: {} })).toMatchObject({ ok: false, error: { status: 404, code: "not_found" } });
    const failing = await approveInvoice(db, { workspaceId: "ws-1", id, body: {} });
    expect(failing).toMatchObject({ ok: false, error: { status: 422, code: "checks_fail", details: ["Subtotal 1250.00 + tax 250.00 = 1500.00, but the total is 1550.00"] } });
    expect(await approveInvoice(db, { workspaceId: "ws-1", id, body: { invoice: { total: "1,500" } } })).toMatchObject({ ok: false, error: { status: 422, code: "invalid_values" } });
    expect((await approveInvoice(db, { workspaceId: "ws-1", id, body: { accept_failing_checks: true } })).ok).toBe(true);
    expect(await approveInvoice(db, { workspaceId: "ws-1", id, body: {} })).toMatchObject({ ok: false, error: { status: 409, code: "not_waiting_for_review" } });
  });
});
