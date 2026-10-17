import type { ConfidenceReason } from "./confidence";
import { HEADER_FIELDS, type FieldName, type InvoiceData } from "./invoice";
import { formatMicros, isIsoCurrency, minorDigits, toMicros } from "./money";
import type { RuleCode, RuleResult } from "./rules";

/**
 * Auditors' tick marks: the checks behind each field's confidence, shown the
 * way an auditor marks a workpaper. A value is vouched (✓) when it is found on
 * the source document, line items extend (×) when quantity × price = amount,
 * foot (Σ) when they add up, and the totals cross-foot (⊕) when subtotal + tax
 * = total. The UI draws these marks; this module decides them.
 */

export type MarkKind = "vouched" | "extended" | "footed" | "crossfooted" | "valid" | "unsure";

/** `open`: the check couldn't run (no text layer, a value edited by the reviewer). */
export type MarkState = "pass" | "fail" | "open";

export type Mark = { kind: MarkKind; state: MarkState; note: string };

export const MARK_GLYPHS: Record<MarkKind, string> = { vouched: "✓", extended: "×", footed: "Σ", crossfooted: "⊕", valid: "!", unsure: "?" };

export const MARK_NAMES: Record<MarkKind, string> = {
  vouched: "Vouched: found on the document",
  extended: "Extended: quantity × unit price = amount",
  footed: "Footed: line items add up",
  crossfooted: "Cross-footed: subtotal + tax = total",
  valid: "Not a usable value",
  unsure: "The model was unsure",
};

const INVALID: Partial<Record<RuleCode, string>> = {
  missing: "required but not found",
  invalid_date: "not a real date",
  invalid_currency: "not an ISO currency code",
  invalid_amount: "not a valid amount",
  due_before_invoice: "due before the invoice date",
  no_line_items: "no line items",
};

export type MarkInput = {
  rules: RuleResult;
  /** The extraction's confidence reasons per field (vouching and the model's doubts come from there). */
  reasons: Partial<Record<FieldName, readonly ConfidenceReason[]>>;
  /** Whether the document had a text layer to vouch against; null before extraction. */
  hasText: boolean | null;
  /** Fields whose value differs from the extraction: their stored vouching no longer applies. */
  edited: ReadonlySet<FieldName>;
};

export function marksFor(data: InvoiceData, { rules, reasons, hasText, edited }: MarkInput): Record<FieldName, Mark[]> {
  const fails = (name: FieldName, rule: RuleCode) => rules.byField[name].includes(rule);
  const result = {} as Record<FieldName, Mark[]>;

  for (const name of [...HEADER_FIELDS, "line_items"] as const) {
    const marks: Mark[] = [];
    const fieldReasons = reasons[name] ?? [];
    const present = name === "line_items" ? data.line_items.length > 0 : data[name] !== null;

    // ✓ Vouched: only for values the extraction checked against the text, and only while unedited.
    if (edited.has(name)) {
      if (present) marks.push({ kind: "vouched", state: "open", note: "edited: not checked against the document" });
    } else if (fieldReasons.includes("absent_but_mentioned")) {
      marks.push({ kind: "vouched", state: "fail", note: "left empty, but the document seems to show one" });
    } else if (present && hasText === false) {
      marks.push({ kind: "vouched", state: "open", note: "no text layer to check against (a scan or photo)" });
    } else if (present && hasText) {
      const missing = fieldReasons.includes("not_in_text");
      marks.push({ kind: "vouched", state: missing ? "fail" : "pass", note: missing ? "not found on the document" : "found on the document" });
    }

    if (name === "line_items" && present) {
      const checkable = rules.lineExtends.filter((ok) => ok !== null);
      if (checkable.length) {
        const bad = rules.lineExtends.flatMap((ok, i) => (ok === false ? [i + 1] : []));
        marks.push({ kind: "extended", state: bad.length ? "fail" : "pass", note: bad.length ? `doesn't extend on line ${bad.join(", ")}` : "every line extends" });
      }
    }

    // Σ Footed: the lines against the subtotal (or the total, for an untaxed invoice without one).
    const footTarget: FieldName | null = data.subtotal !== null ? "subtotal" : data.tax === null && data.total !== null ? "total" : null;
    if ((name === "line_items" && present && footTarget) || name === footTarget) {
      const bad = fails("line_items", "line_items_sum_mismatch");
      marks.push({ kind: "footed", state: bad ? "fail" : "pass", note: bad ? "line items don't add up" : "line items add up" });
    }

    // ⊕ Cross-footed: subtotal + tax = total.
    if ((name === "subtotal" || name === "total" || (name === "tax" && data.tax !== null)) && data.subtotal !== null && data.total !== null) {
      const bad = fails(name, "total_mismatch");
      marks.push({ kind: "crossfooted", state: bad ? "fail" : "pass", note: bad ? "subtotal + tax ≠ total" : "subtotal + tax = total" });
    }

    for (const rule of rules.byField[name]) {
      const note = INVALID[rule];
      if (note) marks.push({ kind: "valid", state: "fail", note });
    }

    if (!edited.has(name) && fieldReasons.includes("model_uncertain")) marks.push({ kind: "unsure", state: "fail", note: "the model was unsure" });

    result[name] = marks;
  }
  return result;
}

/** A field needs a person when any of its marks failed. */
export const flagged = (marks: readonly Mark[]) => marks.some((m) => m.state === "fail");

/** The figures behind the footing marks: what the lines add up to, and subtotal + tax. Null when they can't be computed. */
export function footings(data: InvoiceData): { lines: string | null; subtotalPlusTax: string | null } {
  const digits = data.currency && isIsoCurrency(data.currency) ? minorDigits(data.currency) : 2;
  const amounts = data.line_items.map((item) => toMicros(item.amount));
  const lines = amounts.length && amounts.every((a) => a !== null) ? formatMicros(amounts.reduce((sum, a) => sum! + a!, 0n)!, digits) : null;
  const subtotal = data.subtotal === null ? null : toMicros(data.subtotal);
  const tax = data.tax === null ? 0n : toMicros(data.tax);
  return { lines, subtotalPlusTax: subtotal !== null && tax !== null ? formatMicros(subtotal + tax, digits) : null };
}
