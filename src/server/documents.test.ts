import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents, extractions, fields, lineItems } from "@/db/schema";
import type { CallModel } from "@/extraction/model";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { answer, invoice, invoiceText, memoryStorage, modelReturning, queuedPdf, textPdf, uploadBlankPdf, type MemoryStorage } from "@/test/fixtures";
import { FAILURE_MESSAGES, MAX_RUNS, STALE_AFTER_MS, canRetry, confirmUpload, getDocument, listDocuments, processDocument, retryDocument, startUpload, storageName } from "./documents";

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

const uploadPdf = (storage: MemoryStorage, workspaceId = "ws-1", pages = 1) => uploadBlankPdf(db, storage, workspaceId, pages);

describe("upload", () => {
  it("records the document, then queues it once the stored file checks out", async () => {
    const storage = memoryStorage();
    const { id, doc } = await uploadPdf(storage);
    expect(doc).toMatchObject({ status: "uploading", workspaceId: "ws-1", fileKey: `uploads/${id}/March-invoice-final.pdf`, source: "upload" });
    expect(await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id })).toEqual({ ok: true, queued: true });
    const [queued] = await db.select().from(documents).where(eq(documents.id, id));
    expect(queued).toMatchObject({ status: "queued", pages: 1 });
  });

  it("rejects unsupported types and oversized files before handing out a URL", async () => {
    const { storage } = memoryStorage();
    const base = { workspaceId: "ws-1", fileName: "x", sizeBytes: 1000 };
    expect(await startUpload(db, storage, { ...base, mediaType: "image/heic" })).toEqual({ ok: false, error: "Upload a PDF, or a JPEG, PNG or WebP photo." });
    expect(await startUpload(db, storage, { ...base, mediaType: "application/pdf", sizeBytes: 11 * 1024 * 1024 })).toEqual({ ok: false, error: "Files can be up to 10 MB." });
    expect(await db.select().from(documents)).toEqual([]);
  });

  it("stops at the daily upload cap", async () => {
    const { storage } = memoryStorage();
    const input = { workspaceId: "ws-1", fileName: "a.pdf", mediaType: "application/pdf", sizeBytes: 100 };
    expect((await startUpload(db, storage, input, { dailyLimit: 2 })).ok).toBe(true);
    expect((await startUpload(db, storage, input, { dailyLimit: 2 })).ok).toBe(true);
    const third = await startUpload(db, storage, input, { dailyLimit: 2 });
    expect(third.ok).toBe(false);
    // Uploads older than 24 hours don't count.
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect((await startUpload(db, storage, input, { dailyLimit: 2, now: tomorrow })).ok).toBe(true);
  });

  it("only confirms this browser's own upload, and only once the file has arrived", async () => {
    const storage = memoryStorage();
    const { id, doc } = await uploadPdf(storage);
    expect(await confirmUpload(db, storage.storage, { workspaceId: "someone-else", id })).toEqual({ ok: false, error: "That upload wasn't found." });
    storage.files.delete(doc.fileKey);
    expect(await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id })).toEqual({ ok: false, error: "The file didn't arrive. Please try again." });
  });

  it("fails PDFs that are too long or unreadable, without queueing them", async () => {
    const storage = memoryStorage();
    const long = await uploadPdf(storage, "ws-1", 6);
    expect(await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id: long.id })).toEqual({ ok: true, queued: false });
    const [failed] = await db.select().from(documents).where(eq(documents.id, long.id));
    expect(failed).toMatchObject({ status: "failed", pages: 6, error: "This PDF has 6 pages; the demo reads invoices of up to 5 pages." });

    const broken = await uploadPdf(storage);
    storage.files.set(broken.doc.fileKey, new Uint8Array(broken.data.byteLength).fill(7));
    await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id: broken.id });
    const [unreadable] = await db.select().from(documents).where(eq(documents.id, broken.id));
    expect(unreadable.status).toBe("failed");
  });
});

describe("processDocument", () => {
  async function queued(storage = memoryStorage()) {
    const { id } = await uploadPdf(storage);
    await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id });
    return { id, storage };
  }

  it("stores validated fields with their rule failures and logs the call", async () => {
    const { id, storage } = await queued();
    const wrongTotal = { ...invoice, total: "1600.00", uncertain: [{ field: "total", reason: "Smudged" }] };
    await processDocument(db, storage.storage, modelReturning(answer(wrongTotal)), id);

    const view = (await getDocument(db, id, "ws-1"))!;
    expect(view.doc.status).toBe("needs_review");
    expect(view.fields.map((f) => [f.name, f.value])).toEqual([
      ["supplier_name", "Copperleaf Studio Ltd"],
      ["invoice_number", "INV-2041"],
      ["invoice_date", "2026-10-01"],
      ["due_date", "2026-10-31"],
      ["currency", "GBP"],
      ["subtotal", "1250.00"],
      ["tax", "250.00"],
      ["total", "1600.00"],
      ["line_items", "2"],
    ]);
    const total = view.fields.find((f) => f.name === "total")!;
    expect(total).toMatchObject({ ruleFailures: ["total_mismatch"], modelUncertain: "Smudged", confidence: "low", confidenceReasons: ["rule:total_mismatch", "model_uncertain"] });
    expect(view.fields.find((f) => f.name === "supplier_name")).toMatchObject({ confidence: "high", confidenceReasons: [] });
    expect(view.lineItems.map((l) => [l.position, l.quantity, l.amount])).toEqual([
      [1, "10", "1000.00"],
      [2, null, "250.00"],
    ]);
    expect(view.extractions).toHaveLength(1);
    expect(view.extractions[0]).toMatchObject({ attempt: 1, accepted: true, tokensIn: 2400, tokensOut: 600, promptVersion: "v1", model: "claude-opus-5-5" });
  });

  it("never stores output that failed validation, but logs both attempts", async () => {
    const { id, storage } = await queued();
    await processDocument(db, storage.storage, modelReturning(answer("not json"), answer({ ...invoice, total: "£1,500" })), id);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    expect(doc).toMatchObject({ status: "failed", error: FAILURE_MESSAGES.invalid_output });
    expect(await db.select().from(fields)).toEqual([]);
    expect(await db.select().from(lineItems)).toEqual([]);
    const logged = await db.select().from(extractions);
    expect(logged.map((e) => [e.attempt, e.accepted])).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("does nothing for a document that isn't queued (a second call is a no-op)", async () => {
    const { id, storage } = await queued();
    const model = vi.fn(modelReturning(answer(invoice)));
    await processDocument(db, storage.storage, model, id);
    await processDocument(db, storage.storage, model, id);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("approves an invoice automatically when every field is high", async () => {
    const { id, storage } = await queued();
    await processDocument(db, storage.storage, modelReturning(answer(invoice)), id);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    // A blank PDF has no text layer, so only the rules and the model's doubts count.
    expect(doc).toMatchObject({ status: "approved", approval: "auto", hasText: false, runs: 1 });
    expect(doc.approvedAt).toBeInstanceOf(Date);
  });

  it("checks values against the PDF's text and sends unprinted ones to review", async () => {
    const storage = memoryStorage();
    const printed = await queuedPdf(db, storage, { data: await textPdf(invoiceText) });
    await processDocument(db, storage.storage, modelReturning(answer(invoice)), printed);
    expect((await db.select().from(documents).where(eq(documents.id, printed)))[0]).toMatchObject({ status: "approved", hasText: true });

    // Passes every rule, but the model swapped two digits of the invoice number.
    const misread = await queuedPdf(db, storage, { data: await textPdf(invoiceText) });
    await processDocument(db, storage.storage, modelReturning(answer({ ...invoice, invoice_number: "INV-2014" })), misread);
    const view = (await getDocument(db, misread, "ws-1"))!;
    expect(view.doc).toMatchObject({ status: "needs_review", approval: null, approvedAt: null });
    expect(view.fields.filter((f) => f.confidence === "low").map((f) => [f.name, f.confidenceReasons])).toEqual([["invoice_number", ["not_in_text"]]]);
  });

  it("shows a plain message when the API fails, and keeps the details in the log", async () => {
    const { id, storage } = await queued();
    await processDocument(db, storage.storage, async () => {
      throw new Error("401 invalid x-api-key");
    }, id);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    expect(doc.error).toBe(FAILURE_MESSAGES.api_error);
    const [logged] = await db.select().from(extractions);
    expect(logged).toMatchObject({ rawJson: null, errors: ["401 invalid x-api-key"] });
  });

  it("marks the document failed if anything throws", async () => {
    const { id, storage } = await queued();
    await processDocument(db, storage.storage, async () => {
      throw new Error("network down");
    }, id);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    expect(doc.status).toBe("failed");
  });

  it("sends images to the model upright and as JPEG", async () => {
    const storage = memoryStorage();
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
    const started = await startUpload(db, storage.storage, { workspaceId: "ws-1", fileName: "photo.png", mediaType: "image/png", sizeBytes: png.byteLength });
    if (!started.ok) throw new Error(started.error);
    const [doc] = await db.select().from(documents).where(eq(documents.id, started.id));
    storage.files.set(doc.fileKey, new Uint8Array(png));
    await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id: started.id });

    let sent: { mediaType: string; width?: number } | undefined;
    await processDocument(db, storage.storage, async ({ file }) => {
      sent = { mediaType: file.mediaType, width: (await sharp(file.data).metadata()).width };
      return answer(invoice);
    }, started.id);
    expect(sent).toEqual({ mediaType: "image/jpeg", width: 2000 });
  });
});

describe("retry", () => {
  const failing: CallModel = async () => {
    throw new Error("overloaded");
  };

  it("reads a failed document again, up to the run limit", async () => {
    const storage = memoryStorage();
    const id = await queuedPdf(db, storage);
    for (let run = 1; run <= MAX_RUNS; run++) {
      await processDocument(db, storage.storage, failing, id);
      const [doc] = await db.select().from(documents).where(eq(documents.id, id));
      expect(doc).toMatchObject({ status: "failed", runs: run });
      expect(canRetry(doc)).toBe(run < MAX_RUNS);
      expect(await retryDocument(db, { workspaceId: "ws-1", id })).toBe(run < MAX_RUNS);
    }
    expect(await db.select().from(extractions)).toHaveLength(MAX_RUNS);
  });

  it("succeeds on a retry and only for the browser that owns the document", async () => {
    const storage = memoryStorage();
    const id = await queuedPdf(db, storage);
    await processDocument(db, storage.storage, failing, id);
    expect(await retryDocument(db, { workspaceId: "ws-2", id })).toBe(false);
    expect(await retryDocument(db, { workspaceId: "ws-1", id })).toBe(true);
    expect(await retryDocument(db, { workspaceId: "ws-1", id })).toBe(false); // already queued
    await processDocument(db, storage.storage, modelReturning(answer(invoice)), id);
    expect((await db.select().from(documents).where(eq(documents.id, id)))[0]).toMatchObject({ status: "approved", runs: 2, error: null });
  });

  it("does not retry a file that failed its upload checks", async () => {
    const storage = memoryStorage();
    const long = await uploadPdf(storage, "ws-1", 6);
    await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id: long.id });
    expect(await retryDocument(db, { workspaceId: "ws-1", id: long.id })).toBe(false);
  });

  it("requeues a run that was dropped mid-extraction, once it is stale", async () => {
    const storage = memoryStorage();
    const id = await queuedPdf(db, storage);
    // The function died after claiming the document: it stays `extracting`.
    await db.update(documents).set({ status: "extracting", runs: 1 }).where(eq(documents.id, id));
    expect(await retryDocument(db, { workspaceId: "ws-1", id })).toBe(false);
    const later = new Date(Date.now() + STALE_AFTER_MS + 1000);
    expect(await retryDocument(db, { workspaceId: "ws-1", id, now: later })).toBe(true);
    expect((await db.select().from(documents).where(eq(documents.id, id)))[0].status).toBe("queued");
  });
});

describe("access", () => {
  it("shows a browser only its own uploads, plus demo documents", async () => {
    const storage = memoryStorage();
    const mine = await uploadPdf(storage, "ws-1");
    const theirs = await uploadPdf(storage, "ws-2");
    await confirmUpload(db, storage.storage, { workspaceId: "ws-1", id: mine.id });
    await confirmUpload(db, storage.storage, { workspaceId: "ws-2", id: theirs.id });
    await db.update(documents).set({ source: "demo", workspaceId: null }).where(eq(documents.id, theirs.id));

    expect((await listDocuments(db, "ws-1")).map((d) => d.id)).toEqual([mine.id]);
    expect(await getDocument(db, mine.id, "ws-2")).toBeNull();
    expect(await getDocument(db, mine.id, null)).toBeNull();
    expect((await getDocument(db, theirs.id, "ws-1"))?.doc.id).toBe(theirs.id);
    expect((await getDocument(db, theirs.id, null))?.doc.id).toBe(theirs.id);
  });
});

describe("storageName", () => {
  it("keeps a readable name with the right extension", () => {
    expect(storageName("Q3 invoice #12 (copy).PDF", "application/pdf")).toBe("Q3-invoice-12-copy.pdf");
    expect(storageName("../../etc/passwd", "image/png")).toBe("etc-passwd.png");
    expect(storageName("???", "image/jpeg")).toBe("invoice.jpg");
  });
});
