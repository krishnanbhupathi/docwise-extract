import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documents, extractions, fields, lineItems } from "@/db/schema";
import type { CallModel, ModelResponse } from "@/extraction/model";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { confirmUpload, getDocument, listDocuments, processDocument, startUpload, storageName } from "./documents";
import type { FileStorage } from "./storage";

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

/** In-memory storage; `uploaded` simulates the browser's PUT. */
function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    createUploadUrl: async (key) => `https://upload.test/${key}`,
    createDownloadUrl: async (key) => `https://download.test/${key}`,
    head: async (key) => (files.has(key) ? { size: files.get(key)!.byteLength } : null),
    get: async (key) => {
      const file = files.get(key);
      if (!file) throw new Error(`missing ${key}`);
      return file;
    },
    delete: async (key) => void files.delete(key),
  };
  return { storage, files };
}

async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

const invoice = {
  supplier_name: "Copperleaf Studio Ltd",
  invoice_number: "INV-2041",
  invoice_date: "2026-10-01",
  due_date: "2026-10-31",
  currency: "GBP",
  subtotal: "1250.00",
  tax: "250.00",
  total: "1500.00",
  line_items: [
    { description: "Design review", quantity: "10", unit_price: "100.00", amount: "1000.00" },
    { description: "Travel", quantity: null, unit_price: null, amount: "250.00" },
  ],
  uncertain: [],
};

const answer = (body: unknown, patch: Partial<ModelResponse> = {}): ModelResponse => ({
  text: typeof body === "string" ? body : JSON.stringify(body),
  model: "claude-opus-5-5",
  stopReason: "end_turn",
  inputTokens: 2400,
  outputTokens: 600,
  fallbackUsed: false,
  raw: { id: "msg_test" },
  ...patch,
});

const modelReturning = (...answers: ModelResponse[]): CallModel => async () => answers.shift() ?? Promise.reject(new Error("no answer"));

async function uploadPdf(storage: ReturnType<typeof memoryStorage>, workspaceId = "ws-1", pages = 1) {
  const data = await pdf(pages);
  const started = await startUpload(db, storage.storage, { workspaceId, fileName: "March invoice (final).pdf", mediaType: "application/pdf", sizeBytes: data.byteLength });
  if (!started.ok) throw new Error(started.error);
  const [doc] = await db.select().from(documents).where(eq(documents.id, started.id));
  storage.files.set(doc.fileKey, data);
  return { id: started.id, doc, data };
}

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
    expect(total).toMatchObject({ ruleFailures: ["total_mismatch"], modelUncertain: "Smudged", confidence: null });
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
    expect(doc.status).toBe("failed");
    expect(doc.error).toContain("didn't match the format after 2 attempts");
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
