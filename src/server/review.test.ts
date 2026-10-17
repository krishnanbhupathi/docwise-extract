import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents, fields, lineItems } from "@/db/schema";
import type { InvoiceData } from "@/lib/invoice";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { answer, invoice, invoiceData, memoryStorage, modelReturning, queuedPdf } from "@/test/fixtures";
import { currentInvoice, getDocument, processDocument } from "./documents";
import { approveDocument, listApproved, listReviewQueue, type ReviewInput } from "./review";

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

const extracted = invoiceData;

/** A document waiting for review: the model misread the total and said so. */
async function needsReview(workspaceId = "ws-1") {
  const storage = memoryStorage();
  const id = await queuedPdf(db, storage, { workspaceId });
  const misread = { ...invoice, total: "1600.00", uncertain: [{ field: "total", reason: "Smudged" }] };
  await processDocument(db, storage.storage, modelReturning(answer(misread)), id);
  return id;
}

const review = (data: Partial<InvoiceData>, acceptFailingRules = false): ReviewInput => ({ data: { ...extracted, total: "1600.00", ...data }, acceptFailingRules });

describe("approveDocument", () => {
  it("stores corrections beside the extracted values and approves", async () => {
    const id = await needsReview();
    const now = new Date("2026-10-20T10:00:00Z");
    expect(await approveDocument(db, { workspaceId: "ws-1", id, input: review({ total: " 1500.00 " }), now })).toEqual({ ok: true });

    const view = (await getDocument(db, id, "ws-1"))!;
    expect(view.doc).toMatchObject({ status: "approved", approval: "review", approvedAt: now });
    const corrected = view.fields.filter((f) => f.correctedAt);
    expect(corrected.map((f) => [f.name, f.value, f.correctedValue])).toEqual([["total", "1600.00", "1500.00"]]);
    expect(currentInvoice(view.fields, view.lineItems)).toEqual({ ...extracted, total: "1500.00" });
  });

  it("keeps edited line items as a correction, leaving the extracted lines in place", async () => {
    const id = await needsReview();
    const lines = [extracted.line_items[0], { description: "Travel", quantity: null, unit_price: null, amount: "150.00" }, { description: "Parking", quantity: "2", unit_price: "50.00", amount: "100.00" }];
    expect((await approveDocument(db, { workspaceId: "ws-1", id, input: review({ total: "1500.00", line_items: lines }) })).ok).toBe(true);

    const view = (await getDocument(db, id, "ws-1"))!;
    expect(currentInvoice(view.fields, view.lineItems).line_items).toEqual(lines);
    expect(await db.select({ amount: lineItems.amount }).from(lineItems)).toEqual([{ amount: "1000.00" }, { amount: "250.00" }]);
  });

  it("needs a tick to approve an invoice whose checks still fail", async () => {
    const id = await needsReview();
    const refused = await approveDocument(db, { workspaceId: "ws-1", id, input: review({}) });
    expect(refused).toMatchObject({ ok: false, reason: "checks_fail", error: expect.stringContaining("Tick the box") });
    expect((await db.select().from(documents))[0].status).toBe("needs_review");

    expect(await approveDocument(db, { workspaceId: "ws-1", id, input: review({}, true) })).toEqual({ ok: true });
    // Approved as printed: no field was changed, so there are no corrections.
    expect((await db.select().from(fields)).filter((f) => f.correctedAt)).toEqual([]);
  });

  it("refuses values nothing downstream could use, even with the tick", async () => {
    const id = await needsReview();
    const result = await approveDocument(db, {
      workspaceId: "ws-1",
      id,
      input: review({ total: "1,500.00", invoice_date: "01/10/2026", supplier_name: "  ", line_items: [{ description: "Design review", quantity: "ten", unit_price: "100.00", amount: "1000.00" }] }, true),
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      error: "Fix these before approving.",
      problems: [
        "Supplier: Not found on the invoice",
        'Invoice date: "01/10/2026" is not a valid date',
        'Total: "1,500.00" is not a valid GBP amount',
        'Line items: Line 1 quantity "ten" is not a number',
      ],
    });
  });

  it("only approves this browser's documents that are waiting for review", async () => {
    const id = await needsReview();
    expect(await approveDocument(db, { workspaceId: "ws-2", id, input: review({ total: "1500.00" }) })).toMatchObject({ ok: false });
    expect(await approveDocument(db, { workspaceId: "ws-1", id, input: review({ total: "1500.00" }) })).toEqual({ ok: true });
    expect(await approveDocument(db, { workspaceId: "ws-1", id, input: review({ total: "1500.00" }) })).toMatchObject({ ok: false, reason: "not_waiting", error: "This invoice isn't waiting for review." });
  });
});

describe("queue and export", () => {
  it("lists this browser's documents waiting for review, with the fields to check", async () => {
    const id = await needsReview();
    await needsReview("ws-2");
    const queue = await listReviewQueue(db, "ws-1");
    expect(queue.map((q) => q.doc.id)).toEqual([id]);
    expect(queue[0].low.map((f) => [f.name, f.reasons]).sort()).toEqual([
      ["subtotal", ["rule:total_mismatch"]],
      ["tax", ["rule:total_mismatch"]],
      ["total", ["rule:total_mismatch", "model_uncertain"]],
    ]);
  });

  it("exports approved documents with corrections applied, own and demo only", async () => {
    const reviewed = await needsReview();
    await approveDocument(db, { workspaceId: "ws-1", id: reviewed, input: review({ total: "1500.00" }) });
    const waiting = await needsReview();
    const demo = await needsReview("ws-2");
    await approveDocument(db, { workspaceId: "ws-2", id: demo, input: review({}, true) });
    await db.update(documents).set({ source: "demo", workspaceId: null }).where(eq(documents.id, demo));
    const othersApproved = await needsReview("ws-3");
    await approveDocument(db, { workspaceId: "ws-3", id: othersApproved, input: review({}, true) });

    const approved = await listApproved(db, "ws-1");
    expect(approved.map((a) => a.doc.id).sort()).toEqual([reviewed, demo].sort());
    expect(approved.find((a) => a.doc.id === reviewed)).toMatchObject({ corrected: true, invoice: { total: "1500.00" } });
    expect(approved.find((a) => a.doc.id === demo)).toMatchObject({ corrected: false, invoice: { total: "1600.00" } });
    expect(approved.some((a) => a.doc.id === waiting)).toBe(false);
  });
});
