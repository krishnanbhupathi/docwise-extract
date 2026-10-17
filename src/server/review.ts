import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { documents, fields, lineItems } from "@/db/schema";
import type { Database } from "@/db/types";
import { HEADER_FIELDS, type HeaderField, type LineItem } from "@/lib/invoice";
import { blockingProblems, normalizeReview } from "@/lib/review";
import { checkInvoice } from "@/lib/rules";
import { currentInvoice, extractedInvoice } from "./documents";

/**
 * Review: a person checks a `needs_review` invoice against the original,
 * corrects what's wrong and approves it. Corrections are stored next to the
 * extracted values (never over them), so the eval and the log can always
 * tell what the model said from what the reviewer fixed.
 */

const text = z.string().max(500);
const reviewLine = z.object({ description: text, quantity: text.nullable(), unit_price: text.nullable(), amount: text });

export const reviewInput = z.object({
  data: z.object({
    ...(Object.fromEntries(HEADER_FIELDS.map((name) => [name, text.nullable()])) as Record<HeaderField, z.ZodNullable<typeof text>>),
    line_items: z.array(reviewLine).max(200),
  }),
  /** The reviewer confirmed the invoice itself is inconsistent (checks still fail). */
  acceptFailingRules: z.boolean(),
});

export type ReviewInput = z.infer<typeof reviewInput>;

export type ApproveResult = { ok: true } | { ok: false; error: string; problems?: string[] };

const sameLines = (a: LineItem[], b: LineItem[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Approves a document in this browser's review queue with the reviewer's
 * values. A field whose value differs from the extraction gets a correction;
 * one put back to the extracted value loses it.
 */
export async function approveDocument(db: Database, { workspaceId, id, input, now = new Date() }: { workspaceId: string; id: string; input: ReviewInput; now?: Date }): Promise<ApproveResult> {
  const data = normalizeReview(input.data);
  const { failures } = checkInvoice(data);
  const problems = blockingProblems(data, failures);
  if (problems.length) return { ok: false, error: "Fix these before approving.", problems };
  if (failures.length && !input.acceptFailingRules) {
    return { ok: false, error: "Some checks still fail. Tick the box to confirm the invoice itself is inconsistent, or fix the values." };
  }

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .update(documents)
      .set({ status: "approved", approval: "review", approvedAt: now, updatedAt: now })
      .where(and(eq(documents.id, id), eq(documents.workspaceId, workspaceId), eq(documents.status, "needs_review")))
      .returning({ id: documents.id });
    if (!doc) return { ok: false as const, error: "This invoice isn't waiting for review." };

    const [fieldRows, items] = await Promise.all([
      tx.select().from(fields).where(eq(fields.documentId, id)),
      tx.select().from(lineItems).where(eq(lineItems.documentId, id)),
    ]);
    const extracted = extractedInvoice(fieldRows, items);
    for (const row of fieldRows) {
      let corrected: { value: string | null } | null;
      if (row.name === "line_items") {
        corrected = sameLines(data.line_items, extracted.line_items) ? null : { value: JSON.stringify(data.line_items) };
      } else {
        const value = data[row.name as HeaderField];
        corrected = value === row.value ? null : { value };
      }
      await tx
        .update(fields)
        .set(corrected ? { correctedValue: corrected.value, correctedAt: now } : { correctedValue: null, correctedAt: null })
        .where(eq(fields.id, row.id));
    }
    return { ok: true as const };
  });
}

/** How many of this browser's invoices wait for review (the header's badge). */
export async function countReviewQueue(db: Database, workspaceId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.status, "needs_review")));
  return n;
}

/** This browser's invoices waiting for review, oldest first, with the fields that made them wait. */
export async function listReviewQueue(db: Database, workspaceId: string) {
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.status, "needs_review")))
    .orderBy(asc(documents.updatedAt));
  if (!docs.length) return [];
  const low = await db
    .select({ documentId: fields.documentId, name: fields.name, reasons: fields.confidenceReasons })
    .from(fields)
    .where(and(inArray(fields.documentId, docs.map((d) => d.id)), eq(fields.confidence, "low")));
  return docs.map((doc) => ({ doc, low: low.filter((f) => f.documentId === doc.id) }));
}

/** Approved invoices this browser may export (its own, plus demo documents), with corrections applied. */
export async function listApproved(db: Database, workspaceId: string | null) {
  const access = workspaceId ? or(eq(documents.workspaceId, workspaceId), eq(documents.source, "demo")) : eq(documents.source, "demo");
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.status, "approved"), access))
    .orderBy(desc(documents.approvedAt), asc(documents.id));
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);
  const [fieldRows, items] = await Promise.all([
    db.select().from(fields).where(inArray(fields.documentId, ids)),
    db.select().from(lineItems).where(inArray(lineItems.documentId, ids)),
  ]);
  return docs.map((doc) => ({
    doc,
    invoice: currentInvoice(
      fieldRows.filter((f) => f.documentId === doc.id),
      items.filter((l) => l.documentId === doc.id),
    ),
    corrected: fieldRows.some((f) => f.documentId === doc.id && f.correctedAt !== null),
  }));
}

export type ApprovedInvoice = Awaited<ReturnType<typeof listApproved>>[number];
