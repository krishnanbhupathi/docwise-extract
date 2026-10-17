import type { FieldConfidence } from "@/lib/confidence";
import { FIELD_NAMES, HEADER_FIELDS, type FieldName, type HeaderField, type InvoiceData, type LineItem } from "@/lib/invoice";
import { toMicros } from "@/lib/money";
import type { RuleCode } from "@/lib/rules";
import { normalizeText } from "@/lib/text-check";

/**
 * Scoring for the eval: what the pipeline produced for one invoice against
 * its true values. Pure, so the same code scores a live run and a replay of
 * saved responses.
 *
 * A field is right when it equals the truth after normalising: amounts
 * compare as numbers (1234.5 = 1234.50), dates as ISO strings, currency
 * case-insensitively, names and numbers ignoring case and spacing. A missing
 * value is right only when the truth is missing too.
 */

export type Route = "approved" | "needs_review" | "failed";

export type AttemptLog = { model: string; stopReason: string | null; inputTokens: number; outputTokens: number; ms: number; fallbackUsed: boolean; costUsd: number | null };

/** What the pipeline did with one invoice. */
export type DocOutcome = {
  id: string;
  kind: string;
  /** Rules the true values fail on purpose: such an invoice must never be approved automatically. */
  expectedRuleFailures: RuleCode[];
  route: Route;
  extracted: InvoiceData | null;
  confidence: Record<FieldName, FieldConfidence> | null;
  error: string | null;
  attempts: AttemptLog[];
};

const AMOUNTS: readonly HeaderField[] = ["subtotal", "tax", "total"];

const sameNumber = (a: string | null, b: string | null) => (a === null || b === null ? a === b : toMicros(a) !== null && toMicros(a) === toMicros(b));
const sameText = (a: string | null, b: string | null) => (a === null || b === null ? a === b : normalizeText(a) === normalizeText(b));

export function fieldMatches(name: HeaderField, got: string | null, want: string | null): boolean {
  if (AMOUNTS.includes(name)) return sameNumber(got, want);
  if (name === "currency") return (got?.trim().toUpperCase() ?? null) === (want?.trim().toUpperCase() ?? null);
  if (name === "invoice_date" || name === "due_date") return (got?.trim() ?? null) === want;
  return sameText(got, want);
}

export function lineMatches(got: LineItem, want: LineItem): boolean {
  return sameText(got.description, want.description) && sameNumber(got.quantity, want.quantity) && sameNumber(got.unit_price, want.unit_price) && sameNumber(got.amount, want.amount);
}

/** Pairs extracted lines with true lines (order-insensitive): matched, missed and extra lines. */
export function matchLines(got: LineItem[], want: LineItem[]) {
  const free = want.map((_, i) => i);
  const extra: LineItem[] = [];
  let matched = 0;
  for (const line of got) {
    const at = free.findIndex((i) => lineMatches(line, want[i]));
    if (at >= 0) {
      free.splice(at, 1);
      matched++;
    } else extra.push(line);
  }
  return { matched, extracted: got.length, truth: want.length, missed: free.map((i) => want[i]), extra };
}

export type FieldScore = { correct: boolean; high: boolean; got: string | null; want: string | null };

export type DocScore = {
  id: string;
  kind: string;
  route: Route;
  fields: Record<FieldName, FieldScore>;
  lines: ReturnType<typeof matchLines>;
  fullyCorrect: boolean;
  /** Wrong fields that were marked high confidence: the errors that would reach the books unseen. */
  escapedFields: FieldName[];
  /** Approved automatically although it had a wrong field, or although the invoice itself doesn't add up. */
  escaped: boolean;
  /** Something about it needed a person: a wrong field, or a deliberate inconsistency. */
  neededReview: boolean;
  costUsd: number;
  ms: number;
};

export function scoreDocument(outcome: DocOutcome, truth: InvoiceData): DocScore {
  const got = outcome.extracted;
  const lines = matchLines(got?.line_items ?? [], truth.line_items);
  const linesCorrect = got !== null && lines.matched === lines.truth && lines.extra.length === 0;
  const fields = {} as Record<FieldName, FieldScore>;
  for (const name of FIELD_NAMES) {
    const high = outcome.confidence?.[name].confidence === "high";
    if (name === "line_items") {
      fields[name] = { correct: linesCorrect, high, got: got ? String(got.line_items.length) : null, want: String(truth.line_items.length) };
    } else {
      const value = got ? got[name] : null;
      fields[name] = { correct: got !== null && fieldMatches(name, value, truth[name]), high, got: value, want: truth[name] };
    }
  }
  const fullyCorrect = FIELD_NAMES.every((name) => fields[name].correct);
  const escapedFields = outcome.route === "failed" ? [] : FIELD_NAMES.filter((name) => !fields[name].correct && fields[name].high);
  const neededReview = !fullyCorrect || outcome.expectedRuleFailures.length > 0;
  return {
    id: outcome.id,
    kind: outcome.kind,
    route: outcome.route,
    fields,
    lines,
    fullyCorrect,
    escapedFields,
    escaped: outcome.route === "approved" && neededReview,
    neededReview,
    costUsd: outcome.attempts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
    ms: outcome.attempts.reduce((sum, a) => sum + a.ms, 0),
  };
}

/** The value at a percentile (nearest rank), e.g. 0.5 for the median. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const ratio = (part: number, whole: number) => (whole ? part / whole : null);

export function summarize(scores: DocScore[]) {
  const n = scores.length;
  const count = (test: (s: DocScore) => boolean) => scores.filter(test).length;
  const fieldAccuracy = Object.fromEntries(FIELD_NAMES.map((name) => [name, ratio(count((s) => s.fields[name].correct), n)])) as Record<FieldName, number | null>;
  const headerCorrect = scores.reduce((sum, s) => sum + HEADER_FIELDS.filter((name) => s.fields[name].correct).length, 0);
  const matched = scores.reduce((sum, s) => sum + s.lines.matched, 0);
  const extracted = scores.reduce((sum, s) => sum + s.lines.extracted, 0);
  const truth = scores.reduce((sum, s) => sum + s.lines.truth, 0);
  const precision = ratio(matched, extracted);
  const recall = ratio(matched, truth);
  const reviewed = (s: DocScore) => s.route !== "approved";

  return {
    documents: n,
    routes: { approved: count((s) => s.route === "approved"), needsReview: count((s) => s.route === "needs_review"), failed: count((s) => s.route === "failed") },
    fieldAccuracy,
    headerFieldAccuracy: ratio(headerCorrect, n * HEADER_FIELDS.length),
    lineItems: { matched, extracted, truth, precision, recall, f1: precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null },
    fullyCorrect: { count: count((s) => s.fullyCorrect), rate: ratio(count((s) => s.fullyCorrect), n) },
    reviewRate: ratio(count(reviewed), n),
    escapedErrors: {
      fields: scores.reduce((sum, s) => sum + s.escapedFields.length, 0),
      documents: count((s) => s.escaped),
    },
    // Where each invoice went against whether it needed a person.
    routing: {
      approvedCorrect: count((s) => s.route === "approved" && !s.neededReview),
      approvedWrong: count((s) => s.route === "approved" && s.neededReview),
      reviewedNeeded: count((s) => reviewed(s) && s.neededReview),
      reviewedUnneeded: count((s) => reviewed(s) && !s.neededReview),
    },
    costUsd: { total: scores.reduce((sum, s) => sum + s.costUsd, 0), median: percentile(scores.map((s) => s.costUsd), 0.5), p95: percentile(scores.map((s) => s.costUsd), 0.95) },
    seconds: { median: percentile(scores.map((s) => s.ms / 1000), 0.5), p95: percentile(scores.map((s) => s.ms / 1000), 0.95) },
    byKind: Object.fromEntries(
      [...new Set(scores.map((s) => s.kind))].map((kind) => {
        const slice = scores.filter((s) => s.kind === kind);
        return [kind, { documents: slice.length, fullyCorrect: slice.filter((s) => s.fullyCorrect).length, reviewed: slice.filter(reviewed).length, escapedFields: slice.reduce((sum, s) => sum + s.escapedFields.length, 0), escapedDocuments: slice.filter((s) => s.escaped).length }];
      }),
    ),
  };
}

export type Metrics = ReturnType<typeof summarize>;
