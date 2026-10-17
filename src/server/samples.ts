import { and, eq, inArray } from "drizzle-orm";
import { documents, extractions, fields, lineItems } from "@/db/schema";
import type { Database } from "@/db/types";
import { SAMPLES, sampleId } from "@/lib/samples";
import { newDocumentId } from "./documents";

/** The demo's samples in their fixed order, with the values a card shows. */
export async function listSamples(db: Database) {
  const ids = SAMPLES.map(sampleId);
  const [docs, values] = await Promise.all([
    db.select().from(documents).where(and(inArray(documents.id, ids), eq(documents.source, "demo"))),
    db
      .select({ documentId: fields.documentId, name: fields.name, value: fields.value })
      .from(fields)
      .where(and(inArray(fields.documentId, ids), inArray(fields.name, ["supplier_name", "currency", "total"]))),
  ]);
  return SAMPLES.flatMap((sample) => {
    const doc = docs.find((d) => d.id === sampleId(sample));
    if (!doc) return [];
    const value = (name: string) => values.find((v) => v.documentId === doc.id && v.name === name)?.value ?? null;
    return [{ sample, doc, supplier: value("supplier_name"), currency: value("currency"), total: value("total") }];
  });
}

/**
 * A private copy of a sample that waits for review, in this browser's
 * workspace, so a visitor can correct and approve it without changing the
 * sample for anyone else. Copies the stored extraction; no model call. A
 * browser that already has an unapproved copy gets that one back.
 */
export async function copySample(db: Database, { workspaceId, id }: { workspaceId: string; id: string }): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [sample] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.source, "demo"), eq(documents.status, "needs_review")));
    if (!sample) return null;
    const [mine] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.copiedFrom, id), eq(documents.status, "needs_review")));
    if (mine) return mine.id;

    const copy = newDocumentId();
    const now = new Date();
    await tx.insert(documents).values({
      id: copy,
      workspaceId,
      source: "upload",
      copiedFrom: id,
      fileKey: sample.fileKey,
      fileName: sample.fileName,
      mediaType: sample.mediaType,
      sizeBytes: sample.sizeBytes,
      pages: sample.pages,
      status: sample.status,
      runs: sample.runs,
      hasText: sample.hasText,
      createdAt: now,
      updatedAt: now,
    });

    const attempts = await tx.select().from(extractions).where(eq(extractions.documentId, id));
    const extractionIds = new Map<string, string>();
    // `id: undefined` lets each copied row get a new id.
    for (const attempt of attempts) {
      const [row] = await tx.insert(extractions).values({ ...attempt, id: undefined, documentId: copy }).returning({ id: extractions.id });
      extractionIds.set(attempt.id, row.id);
    }
    const [fieldRows, items] = await Promise.all([
      tx.select().from(fields).where(eq(fields.documentId, id)),
      tx.select().from(lineItems).where(eq(lineItems.documentId, id)),
    ]);
    if (fieldRows.length) {
      await tx.insert(fields).values(fieldRows.map((row) => ({ ...row, id: undefined, documentId: copy, extractionId: extractionIds.get(row.extractionId)! })));
    }
    if (items.length) {
      await tx.insert(lineItems).values(items.map((item) => ({ ...item, id: undefined, documentId: copy, extractionId: extractionIds.get(item.extractionId)! })));
    }
    return copy;
  });
}
