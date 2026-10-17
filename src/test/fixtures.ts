import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { documents } from "@/db/schema";
import type { CallModel, ModelResponse } from "@/extraction/model";
import type { InvoiceData } from "@/lib/invoice";
import type { FileStorage } from "@/server/storage";
import { confirmUpload, startUpload } from "@/server/documents";
import type { TestDb } from "./db";

/** In-memory storage; putting a file in `files` stands in for the browser's PUT. */
export function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    createUploadUrl: async (key) => `https://upload.test/${key}`,
    createDownloadUrl: async (key) => `https://download.test/${key}`,
    put: async (key, data) => void files.set(key, data),
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

export type MemoryStorage = ReturnType<typeof memoryStorage>;

/** A PDF with the given lines of text on one page (a text layer for the text check), or blank pages. */
export async function textPdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 16, size: 10, font }));
  return doc.save();
}

export async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

/** A consistent GBP invoice, as stored (no `uncertain`). */
export const invoiceData: InvoiceData = {
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
};

/** The same invoice as a model answer. */
export const invoice = { ...invoiceData, uncertain: [] as { field: string; reason: string }[] };

export const answer = (body: unknown, patch: Partial<ModelResponse> = {}): ModelResponse => ({
  text: typeof body === "string" ? body : JSON.stringify(body),
  model: "claude-opus-5-5",
  stopReason: "end_turn",
  inputTokens: 2400,
  outputTokens: 600,
  fallbackUsed: false,
  raw: { id: "msg_test" },
  ...patch,
});

export const modelReturning = (...answers: ModelResponse[]): CallModel => async () => answers.shift() ?? Promise.reject(new Error("no answer"));

/** Starts an upload of a PDF (blank pages unless `data` is given) and puts the file in storage, as the browser would. */
export async function uploadBlankPdf(db: TestDb, storage: MemoryStorage, workspaceId = "ws-1", pages = 1, data?: Uint8Array) {
  data ??= await pdf(pages);
  const started = await startUpload(db, storage.storage, { workspaceId, fileName: "March invoice (final).pdf", mediaType: "application/pdf", sizeBytes: data.byteLength });
  if (!started.ok) throw new Error(started.error);
  const [doc] = await db.select().from(documents).where(eq(documents.id, started.id));
  storage.files.set(doc.fileKey, data);
  return { id: started.id, doc, data };
}


/** An uploaded, confirmed PDF waiting for extraction. */
export async function queuedPdf(db: TestDb, storage: MemoryStorage, { workspaceId = "ws-1", data }: { workspaceId?: string; data?: Uint8Array } = {}) {
  const { id } = await uploadBlankPdf(db, storage, workspaceId, 1, data);
  await confirmUpload(db, storage.storage, { workspaceId, id });
  return id;
}

/** The text a correct GBP invoice (`invoice`) would print. */
export const invoiceText = [
  "Copperleaf Studio Ltd    Invoice INV-2041",
  "Date 1 October 2026    Due 31 October 2026",
  "Design review    10    GBP 100.00    GBP 1,000.00",
  "Travel    GBP 250.00",
  "Subtotal GBP 1,250.00    VAT 20% GBP 250.00    Total GBP 1,500.00",
];
