import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { documents } from "@/db/schema";
import type { Database } from "@/db/types";
import { HEADER_FIELDS, type HeaderField } from "@/lib/invoice";
import { costUsd } from "@/lib/pricing";
import { checkInvoice } from "@/lib/rules";
import { currentInvoice, extractedInvoice, getDocument, type DocumentView } from "./documents";
import { approveDocument, reviewInput, reviewLine, reviewText } from "./review";

/**
 * The JSON API's shapes and actions (routes under /api/v1). A key acts for the
 * browser workspace that created it; samples can be read but not approved.
 */

export type ApiError = { status: number; code: string; message: string; details?: string[] };

export function errorResponse({ status, code, message, details }: ApiError, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status, headers });
}

/** An invoice as the API returns it: current values (corrections applied), what the model read, confidence, failing checks and cost. */
export function invoiceJson(view: DocumentView, origin: string) {
  const { doc } = view;
  const read = view.fields.length > 0;
  const current = read ? currentInvoice(view.fields, view.lineItems) : null;
  const accepted = view.extractions.filter((e) => e.accepted).at(-1);
  return {
    id: doc.id,
    status: doc.status,
    approval: doc.approval,
    sample: doc.source === "demo",
    file_name: doc.fileName,
    media_type: doc.mediaType,
    pages: doc.pages,
    created_at: doc.createdAt.toISOString(),
    approved_at: doc.approvedAt?.toISOString() ?? null,
    error: doc.error,
    invoice: current,
    extracted: read ? extractedInvoice(view.fields, view.lineItems) : null,
    corrected_fields: view.fields.filter((f) => f.correctedAt).map((f) => f.name),
    confidence: Object.fromEntries(view.fields.map((f) => [f.name, { level: f.confidence, reasons: f.confidenceReasons, model_note: f.modelUncertain }])),
    checks: current ? checkInvoice(current).failures.map(({ rule, fields, message }) => ({ rule, fields, message })) : [],
    extraction: view.extractions.length
      ? {
          model: accepted?.model ?? view.extractions.at(-1)!.model,
          prompt_version: view.extractions.at(-1)!.promptVersion,
          attempts: view.extractions.length,
          tokens_in: view.extractions.reduce((sum, e) => sum + e.tokensIn, 0),
          tokens_out: view.extractions.reduce((sum, e) => sum + e.tokensOut, 0),
          seconds: Number((view.extractions.reduce((sum, e) => sum + e.ms, 0) / 1000).toFixed(2)),
          cost_usd: Number(view.extractions.reduce((sum, e) => sum + (costUsd(e.model, e.tokensIn, e.tokensOut) ?? 0), 0).toFixed(6)),
        }
      : null,
    links: { self: `${origin}/api/v1/invoices/${doc.id}`, review: `${origin}/documents/${doc.id}` },
  };
}

const LISTED = ["queued", "extracting", "needs_review", "approved", "failed"] as const;
export const listQuery = z.object({
  status: z.enum(LISTED).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** This workspace's invoices, newest first. */
export async function listInvoices(db: Database, workspaceId: string, { status, limit }: z.infer<typeof listQuery>, origin: string) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), status ? eq(documents.status, status) : inArray(documents.status, [...LISTED])))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
  return rows.map((doc) => ({
    id: doc.id,
    status: doc.status,
    approval: doc.approval,
    file_name: doc.fileName,
    created_at: doc.createdAt.toISOString(),
    links: { self: `${origin}/api/v1/invoices/${doc.id}`, review: `${origin}/documents/${doc.id}` },
  }));
}

/** Corrections are partial: fields left out keep their current value. */
export const approveBody = z
  .object({
    invoice: z
      .object({
        ...(Object.fromEntries(HEADER_FIELDS.map((name) => [name, reviewText.nullable().optional()])) as Record<HeaderField, z.ZodOptional<z.ZodNullable<typeof reviewText>>>),
        line_items: z.array(reviewLine).max(200).optional(),
      })
      .strict()
      .optional(),
    accept_failing_checks: z.boolean().optional(),
  })
  .strict();

export type ApproveResult = { ok: true; view: DocumentView } | { ok: false; error: ApiError };

/** Approves an invoice in this workspace's review queue, with the caller's corrections. */
export async function approveInvoice(db: Database, { workspaceId, id, body }: { workspaceId: string; id: string; body: z.infer<typeof approveBody> }): Promise<ApproveResult> {
  const view = await getDocument(db, id, workspaceId);
  if (!view) return { ok: false, error: { status: 404, code: "not_found", message: "No invoice with that id for this key." } };
  if (view.doc.source === "demo") {
    return { ok: false, error: { status: 403, code: "sample_read_only", message: "Samples are shared by every visitor and can't be approved. Upload an invoice to review your own." } };
  }
  if (view.doc.status !== "needs_review") {
    return { ok: false, error: { status: 409, code: "not_waiting_for_review", message: `This invoice is ${view.doc.status.replace("_", " ")}, not waiting for review.` } };
  }
  const changes = Object.fromEntries(Object.entries(body.invoice ?? {}).filter(([, value]) => value !== undefined));
  const input = reviewInput.parse({ data: { ...currentInvoice(view.fields, view.lineItems), ...changes }, acceptFailingRules: body.accept_failing_checks ?? false });
  const result = await approveDocument(db, { workspaceId, id, input });
  if (!result.ok) {
    const message = {
      invalid_values: "Some values can't be used. Fix them and approve again.",
      checks_fail: "Some checks still fail. Fix the values, or send accept_failing_checks: true to confirm the invoice itself doesn't add up.",
      not_waiting: "This invoice isn't waiting for review.",
    }[result.reason];
    const code = result.reason === "not_waiting" ? "not_waiting_for_review" : result.reason;
    return { ok: false, error: { status: result.reason === "not_waiting" ? 409 : 422, code, message, details: result.problems } };
  }
  return { ok: true, view: (await getDocument(db, id, workspaceId))! };
}
