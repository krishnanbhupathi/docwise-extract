import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, or } from "drizzle-orm";
import { documents, extractions, fields, lineItems } from "@/db/schema";
import type { Database } from "@/db/types";
import { extractInvoice, type ExtractResult } from "@/extraction/extract";
import { MEDIA_TYPES, type CallModel, type MediaType } from "@/extraction/model";
import { MAX_BYTES, MAX_PAGES, pdfPageCount, prepareForModel } from "@/extraction/prepare";
import { EFFORT, MODEL, PROMPT_VERSION } from "@/extraction/prompt";
import { FIELD_NAMES, type FieldName } from "@/lib/invoice";
import { checkInvoice } from "@/lib/rules";
import type { FileStorage } from "./storage";

/** Uploads accepted per rolling 24 hours across the whole public demo (cost cap on the API key). */
export const DAILY_UPLOAD_LIMIT = Number(process.env.DOCWISE_DAILY_UPLOADS || 50);

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

/** Step 1 of an upload: checks type, size and the daily cap, records the document, and hands out a signed upload URL. */
export async function startUpload(db: Database, storage: FileStorage, input: StartUpload, { dailyLimit = DAILY_UPLOAD_LIMIT, now = new Date() } = {}): Promise<StartUploadResult> {
  if (!isMediaType(input.mediaType)) return { ok: false, error: "Upload a PDF, or a JPEG, PNG or WebP photo." };
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: "That file is empty." };
  if (input.sizeBytes > MAX_BYTES) return { ok: false, error: "Files can be up to 10 MB." };

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [{ uploads }] = await db
    .select({ uploads: count() })
    .from(documents)
    .where(and(eq(documents.source, "upload"), gt(documents.createdAt, since)));
  if (uploads >= dailyLimit) {
    return { ok: false, error: `The demo has reached today's limit of ${dailyLimit} uploads. Try a sample invoice, or come back tomorrow.` };
  }

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
    .set({ status: "extracting", error: null, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.status, "queued")))
    .returning();
  if (!doc) return;

  try {
    const file = await prepareForModel(await storage.get(doc.fileKey), doc.mediaType as MediaType);
    await saveExtraction(db, doc.id, await extractInvoice(file, callModel));
  } catch (error) {
    console.error("extraction failed", { documentId: id, error });
    await db
      .update(documents)
      .set({ status: "failed", error: "Something went wrong while reading this invoice.", updatedAt: new Date() })
      .where(eq(documents.id, id));
  }
}

/** Logs every attempt and, for a valid result, stores the fields with their rule failures. One transaction. */
export async function saveExtraction(db: Database, documentId: string, result: ExtractResult) {
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
      await tx.update(documents).set({ status: "failed", error: result.error, updatedAt: new Date() }).where(eq(documents.id, documentId));
      return;
    }

    const extractionId = logged.at(-1)!.id;
    const { uncertain, ...data } = result.data;
    const { byField } = checkInvoice(data);
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
    // Confidence and auto-approval arrive on Day 2; until then a person checks every invoice.
    await tx.update(documents).set({ status: "needs_review", error: null, updatedAt: new Date() }).where(eq(documents.id, documentId));
  });
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

