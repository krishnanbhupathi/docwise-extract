import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { documents, extractions, fields, lineItems } from "@/db/schema";
import type { Database } from "@/db/types";
import { extractInvoice, type ExtractResult, type FailureKind } from "@/extraction/extract";
import { MEDIA_TYPES, type CallModel, type MediaType } from "@/extraction/model";
import { MAX_BYTES, MAX_PAGES, pdfPageCount, pdfText, prepareForModel } from "@/extraction/prepare";
import { EFFORT, MODEL, PROMPT_VERSION } from "@/extraction/prompt";
import { allHigh, scoreConfidence } from "@/lib/confidence";
import { FIELD_NAMES, HEADER_FIELDS, type FieldName, type HeaderField, type InvoiceData, type LineItem } from "@/lib/invoice";
import { checkInvoice } from "@/lib/rules";
import { capReached, type CapOptions } from "./limits";
import type { FileStorage } from "./storage";

/** Extraction runs per document, the first included; each one can cost up to two model calls. */
export const MAX_RUNS = 3;

/** A document still `queued` or `extracting` after this long was dropped (the function has a 300 s limit). */
export const STALE_AFTER_MS = 6 * 60 * 1000;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 12 characters from a 31-letter alphabet (~59 bits): unguessable, readable, URL-safe. */
export function newDocumentId(): string {
  return Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

const EXTENSIONS: Record<MediaType, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/** A storage-safe file name that keeps the original's readable part and the right extension. */
export function storageName(fileName: string, mediaType: MediaType): string {
  const base = fileName.replace(/\.[a-zA-Z0-9]{1,5}$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "invoice";
  return base + EXTENSIONS[mediaType];
}

const isMediaType = (value: string): value is MediaType => (MEDIA_TYPES as readonly string[]).includes(value);

export type StartUpload = { workspaceId: string; fileName: string; mediaType: string; sizeBytes: number };
export type StartUploadResult = { ok: true; id: string; uploadUrl: string } | { ok: false; error: string };

/** Step 1 of an upload: checks type, size and the daily caps, records the document, and hands out a signed upload URL. */
export async function startUpload(db: Database, storage: FileStorage, input: StartUpload, caps: CapOptions = {}): Promise<StartUploadResult> {
  if (!isMediaType(input.mediaType)) return { ok: false, error: "Upload a PDF, or a JPEG, PNG or WebP photo." };
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: "That file is empty." };
  if (input.sizeBytes > MAX_BYTES) return { ok: false, error: "Files can be up to 10 MB." };
  const closed = await capReached(db, "upload", caps);
  if (closed) return { ok: false, error: closed };

  const id = newDocumentId();
  const fileKey = `uploads/${id}/${storageName(input.fileName, input.mediaType)}`;
  await db.insert(documents).values({
    id,
    workspaceId: input.workspaceId,
    fileKey,
    fileName: input.fileName.slice(0, 200) || "invoice",
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
  });
  const uploadUrl = await storage.createUploadUrl(fileKey, { contentType: input.mediaType, contentLength: input.sizeBytes });
  return { ok: true, id, uploadUrl };
}

export type ConfirmUploadResult = { ok: true; queued: boolean } | { ok: false; error: string };

/**
 * Step 2: the browser says the file is uploaded. The server checks the stored
 * object itself (it arrived, the size matches, a PDF opens and is short
 * enough) before queueing the document for extraction.
 */
export async function confirmUpload(db: Database, storage: FileStorage, { workspaceId, id }: { workspaceId: string; id: string }): Promise<ConfirmUploadResult> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.workspaceId, workspaceId), eq(documents.status, "uploading")));
  if (!doc) return { ok: false, error: "That upload wasn't found." };

  const stored = await storage.head(doc.fileKey);
  if (!stored) return { ok: false, error: "The file didn't arrive. Please try again." };
  if (stored.size !== doc.sizeBytes) return { ok: false, error: "The uploaded file is incomplete. Please try again." };

  const fail = async (error: string) => {
    await db.update(documents).set({ status: "failed", error, updatedAt: new Date() }).where(eq(documents.id, id));
    return { ok: true as const, queued: false };
  };

  let pages = 1;
  if (doc.mediaType === "application/pdf") {
    try {
      pages = await pdfPageCount(await storage.get(doc.fileKey));
    } catch {
      return fail("This PDF couldn't be opened. It may be damaged or password-protected.");
    }
    if (pages > MAX_PAGES) {
      await db.update(documents).set({ pages }).where(eq(documents.id, id));
      return fail(`This PDF has ${pages} pages; the demo reads invoices of up to ${MAX_PAGES} pages.`);
    }
  }
  await db.update(documents).set({ status: "queued", pages, updatedAt: new Date() }).where(eq(documents.id, id));
  return { ok: true, queued: true };
}

/**
 * Extracts a queued document. Claiming it (queued → extracting) is one
 * conditional update, so a second call for the same document does nothing.
 * Only output that passed validation reaches `fields` and `line_items`.
 */
export async function processDocument(db: Database, storage: FileStorage, callModel: CallModel, id: string): Promise<void> {
  const [doc] = await db
    .update(documents)
    .set({ status: "extracting", error: null, runs: sql`${documents.runs} + 1`, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.status, "queued"), lt(documents.runs, MAX_RUNS)))
    .returning();
  if (!doc) return;

  try {
    const data = await storage.get(doc.fileKey);
    const mediaType = doc.mediaType as MediaType;
    const [file, text] = await Promise.all([prepareForModel(data, mediaType), pdfText(data, mediaType)]);
    await saveExtraction(db, doc.id, await extractInvoice(file, callModel), { text });
  } catch (error) {
    console.error("extraction failed", { documentId: id, error });
    await db
      .update(documents)
      .set({ status: "failed", error: "Something went wrong while reading this invoice.", updatedAt: new Date() })
      .where(eq(documents.id, id));
  }
}

/** What a visitor sees for a failed extraction; the exact errors stay in the extraction log. */
export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  api_error: "The model couldn't be reached just now. Try again in a minute.",
  refused: "The model declined to read this document.",
  truncated: "This invoice is too long to read in one answer.",
  invalid_output: "The model's answer didn't pass validation, even after one retry.",
};

/**
 * Logs every attempt and, for a valid result, stores the fields with their
 * rule failures and confidence, then routes the document: every field high →
 * approved automatically, anything low → a person reviews it. One transaction.
 */
export async function saveExtraction(db: Database, documentId: string, result: ExtractResult, { text = null }: { text?: string | null } = {}) {
  await db.transaction(async (tx) => {
    const logged = await tx
      .insert(extractions)
      .values(
        result.attempts.map((attempt, i) => ({
          documentId,
          attempt: i + 1,
          model: attempt.response?.model ?? MODEL,
          promptVersion: PROMPT_VERSION,
          effort: EFFORT,
          rawJson: attempt.response?.raw ?? null,
          stopReason: attempt.response?.stopReason ?? null,
          tokensIn: attempt.response?.inputTokens ?? 0,
          tokensOut: attempt.response?.outputTokens ?? 0,
          ms: attempt.ms,
          fallbackUsed: attempt.response?.fallbackUsed ?? false,
          accepted: result.ok && i === result.attempts.length - 1,
          errors: attempt.errors,
        })),
      )
      .returning({ id: extractions.id });

    if (!result.ok) {
      await tx.update(documents).set({ status: "failed", error: FAILURE_MESSAGES[result.kind], updatedAt: new Date() }).where(eq(documents.id, documentId));
      return;
    }

    const extractionId = logged.at(-1)!.id;
    const { uncertain, ...data } = result.data;
    const { byField } = checkInvoice(data);
    const scores = scoreConfidence(data, { uncertain, text });
    const uncertainty = (name: FieldName) => uncertain.filter((u) => u.field === name).map((u) => u.reason).join("; ") || null;

    await tx.delete(fields).where(eq(fields.documentId, documentId));
    await tx.delete(lineItems).where(eq(lineItems.documentId, documentId));
    await tx.insert(fields).values(
      FIELD_NAMES.map((name) => ({
        documentId,
        extractionId,
        name,
        value: name === "line_items" ? String(data.line_items.length) : data[name],
        ruleFailures: byField[name],
        modelUncertain: uncertainty(name),
        confidence: scores[name].confidence,
        confidenceReasons: scores[name].reasons,
      })),
    );
    if (data.line_items.length) {
      await tx.insert(lineItems).values(
        data.line_items.map((item, i) => ({
          documentId,
          extractionId,
          position: i + 1,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          amount: item.amount,
        })),
      );
    }
    const now = new Date();
    const routed = allHigh(scores) ? { status: "approved" as const, approval: "auto" as const, approvedAt: now } : { status: "needs_review" as const, approval: null, approvedAt: null };
    await tx
      .update(documents)
      .set({ ...routed, hasText: text !== null, error: null, updatedAt: now })
      .where(eq(documents.id, documentId));
  });
}

type RetryState = { status: string; runs: number; updatedAt: Date };

/**
 * A document can be read again when an extraction run failed, or when a run
 * was dropped (still queued or extracting long after the function's time
 * limit), until the run limit. Failures before any run (a damaged or
 * too-long PDF) can't be fixed by retrying.
 */
export function canRetry(doc: RetryState, now = new Date()): boolean {
  if (doc.runs >= MAX_RUNS) return false;
  if (doc.status === "failed") return doc.runs > 0;
  return (doc.status === "queued" || doc.status === "extracting") && now.getTime() - doc.updatedAt.getTime() > STALE_AFTER_MS;
}

/** Puts a retryable document back in the queue (one conditional update, so two clicks queue it once). */
export async function retryDocument(db: Database, { workspaceId, id, now = new Date() }: { workspaceId: string; id: string; now?: Date }): Promise<boolean> {
  const stale = new Date(now.getTime() - STALE_AFTER_MS);
  const [doc] = await db
    .update(documents)
    .set({ status: "queued", error: null, updatedAt: now })
    .where(
      and(
        eq(documents.id, id),
        eq(documents.workspaceId, workspaceId),
        lt(documents.runs, MAX_RUNS),
        or(and(eq(documents.status, "failed"), gt(documents.runs, 0)), and(inArray(documents.status, ["queued", "extracting"]), lt(documents.updatedAt, stale))),
      ),
    )
    .returning({ id: documents.id });
  return Boolean(doc);
}

/** Documents this browser uploaded, newest first. */
export async function listDocuments(db: Database, workspaceId: string, limit = 20) {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.status, ["queued", "extracting", "needs_review", "approved", "failed"])))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

/** One document with its fields, line items and extraction log, if this browser may see it (its own, or a demo document). */
export async function getDocument(db: Database, id: string, workspaceId: string | null) {
  const access = workspaceId ? or(eq(documents.workspaceId, workspaceId), eq(documents.source, "demo")) : eq(documents.source, "demo");
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), access));
  if (!doc) return null;
  const [fieldRows, items, attempts] = await Promise.all([
    db.select().from(fields).where(eq(fields.documentId, id)),
    db.select().from(lineItems).where(eq(lineItems.documentId, id)).orderBy(asc(lineItems.position)),
    db.select().from(extractions).where(eq(extractions.documentId, id)).orderBy(asc(extractions.createdAt), asc(extractions.attempt)),
  ]);
  const order = (name: string) => FIELD_NAMES.indexOf(name as FieldName);
  return { doc, fields: fieldRows.sort((a, b) => order(a.name) - order(b.name)), lineItems: items, extractions: attempts };
}

export type DocumentView = NonNullable<Awaited<ReturnType<typeof getDocument>>>;

type FieldRow = typeof fields.$inferSelect;
type LineItemRow = typeof lineItems.$inferSelect;

const storedLine = (l: LineItemRow): LineItem => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice, amount: l.amount });

/** The invoice as the model extracted it. */
export function extractedInvoice(fieldRows: FieldRow[], items: LineItemRow[]): InvoiceData {
  const value = (name: HeaderField) => fieldRows.find((f) => f.name === name)?.value ?? null;
  return {
    ...(Object.fromEntries(HEADER_FIELDS.map((name) => [name, value(name)])) as Record<HeaderField, string | null>),
    line_items: [...items].sort((a, b) => a.position - b.position).map(storedLine),
  };
}

/** The invoice with a reviewer's corrections applied: what the review form starts from and what gets exported. */
export function currentInvoice(fieldRows: FieldRow[], items: LineItemRow[]): InvoiceData {
  const data = extractedInvoice(fieldRows, items);
  for (const row of fieldRows) {
    if (!row.correctedAt) continue;
    if (row.name === "line_items") data.line_items = JSON.parse(row.correctedValue ?? "[]") as LineItem[];
    else if ((HEADER_FIELDS as readonly string[]).includes(row.name)) data[row.name as HeaderField] = row.correctedValue;
  }
  return data;
}

