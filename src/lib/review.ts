import { FIELD_LABELS, HEADER_FIELDS, type HeaderField, type InvoiceData, type LineItem } from "./invoice";
import type { RuleCode, RuleFailure } from "./rules";

/** What the review form sends: every value as typed, null for an empty optional field. */
export type ReviewData = Record<HeaderField, string | null> & { line_items: LineItem[] };

/** Checks a reviewer can't approve past: the value isn't usable downstream at all. */
const BLOCKING: readonly RuleCode[] = ["missing", "invalid_date", "invalid_currency", "invalid_amount"];

const blank = (value: string | null) => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** Trims every value and turns empty inputs into null, as the extraction would have. */
export function normalizeReview(data: ReviewData): InvoiceData {
  const header = Object.fromEntries(HEADER_FIELDS.map((name) => [name, blank(data[name])])) as Record<HeaderField, string | null>;
  return {
    ...header,
    currency: header.currency?.toUpperCase() ?? null,
    line_items: data.line_items.map((item) => ({
      description: item.description.trim(),
      quantity: blank(item.quantity),
      unit_price: blank(item.unit_price),
      amount: item.amount.trim(),
    })),
  };
}

/** Problems that stop an approval outright, as messages for the form. */
export function blockingProblems(data: InvoiceData, failures: RuleFailure[]): string[] {
  const problems = failures.filter((f) => BLOCKING.includes(f.rule)).map((f) => `${f.fields.map((name) => FIELD_LABELS[name]).join(", ")}: ${f.message}`);
  data.line_items.forEach((item, i) => {
    if (!item.description) problems.push(`Line items: line ${i + 1} needs a description`);
  });
  return problems;
}
