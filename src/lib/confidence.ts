import { FIELD_NAMES, type FieldName, type InvoiceData } from "./invoice";
import { toMicros } from "./money";
import { checkInvoice, type RuleCode } from "./rules";
import {
  currencyAppears,
  dateAppears,
  dueDateMentioned,
  indexText,
  numberAppears,
  phraseAppears,
  subtotalMentioned,
  taxMentioned,
  wordsAppear,
  type TextIndex,
} from "./text-check";

/**
 * Confidence per field, shared by the app (routing) and the eval (review
 * rate, escaped errors). A field is high only when nothing argues against
 * it: no rule implicates it, the model didn't call it uncertain, and, when
 * the document has a text layer, its value is printed there. Any one reason
 * makes it low, and the reasons are kept so a reviewer sees why.
 */

export type ConfidenceReason =
  | `rule:${RuleCode}`
  /** The model listed the field as uncertain. */
  | "model_uncertain"
  /** The value isn't printed anywhere in the PDF's text layer. */
  | "not_in_text"
  /** The model returned null, but the text names the field next to a value. */
  | "absent_but_mentioned";

export type FieldConfidence = { confidence: "high" | "low"; reasons: ConfidenceReason[] };

export type ConfidenceInput = {
  /** Field names the model listed as uncertain. */
  uncertain: readonly { field: FieldName }[];
  /** The PDF's text layer; null for images and scans, which skips the text check. */
  text: string | null;
};

export function scoreConfidence(data: InvoiceData, { uncertain, text }: ConfidenceInput): Record<FieldName, FieldConfidence> {
  const { byField } = checkInvoice(data);
  const index = text ? indexText(text) : null;
  const result = {} as Record<FieldName, FieldConfidence>;
  for (const name of FIELD_NAMES) {
    const reasons: ConfidenceReason[] = byField[name].map((rule) => `rule:${rule}` as const);
    if (uncertain.some((u) => u.field === name)) reasons.push("model_uncertain");
    if (index) {
      const check = textCheck(name, data, index);
      if (check) reasons.push(check);
    }
    result[name] = { confidence: reasons.length ? "low" : "high", reasons };
  }
  return result;
}

/** True when every field is high, i.e. the invoice can be approved without a person. */
export function allHigh(scores: Record<FieldName, FieldConfidence>): boolean {
  return FIELD_NAMES.every((name) => scores[name].confidence === "high");
}

function textCheck(name: FieldName, data: InvoiceData, index: TextIndex): ConfidenceReason | null {
  if (name === "line_items") {
    const printed = data.line_items.every(
      (item) =>
        wordsAppear(item.description, index) &&
        numberAppears(item.amount, index) &&
        (item.quantity === null || numberAppears(item.quantity, index)) &&
        (item.unit_price === null || numberAppears(item.unit_price, index)),
    );
    return printed ? null : "not_in_text";
  }

  const value = data[name];
  if (value === null) {
    const mentioned =
      (name === "tax" && taxMentioned(index)) || (name === "due_date" && dueDateMentioned(index)) || (name === "subtotal" && subtotalMentioned(index));
    return mentioned ? "absent_but_mentioned" : null;
  }

  switch (name) {
    case "supplier_name":
    case "invoice_number":
      return phraseAppears(value, index) ? null : "not_in_text";
    case "invoice_date":
    case "due_date":
      return dateAppears(value, index) ? null : "not_in_text";
    case "currency":
      return currencyAppears(value, index) ? null : "not_in_text";
    case "tax":
      // A split tax (CGST + SGST) is summed and may never be printed as one number;
      // it's still grounded when it's exactly the printed total minus the printed subtotal.
      return numberAppears(value, index) || taxIsPrintedDifference(data, index) ? null : "not_in_text";
    default:
      return numberAppears(value, index) ? null : "not_in_text";
  }
}

function taxIsPrintedDifference(data: InvoiceData, index: TextIndex): boolean {
  if (data.tax === null || data.subtotal === null || data.total === null) return false;
  if (!numberAppears(data.subtotal, index) || !numberAppears(data.total, index)) return false;
  const [tax, subtotal, total] = [toMicros(data.tax), toMicros(data.subtotal), toMicros(data.total)];
  return tax !== null && subtotal !== null && total !== null && total - subtotal === tax;
}

export const REASON_LABELS: Record<ConfidenceReason, string> = {
  "rule:missing": "required but not found",
  "rule:invalid_date": "not a real date",
  "rule:due_before_invoice": "due date is before the invoice date",
  "rule:invalid_currency": "not an ISO currency code",
  "rule:invalid_amount": "not a valid amount",
  "rule:no_line_items": "no line items",
  "rule:line_amount_mismatch": "quantity × unit price ≠ amount",
  "rule:line_items_sum_mismatch": "line items don't add up",
  "rule:total_mismatch": "subtotal + tax ≠ total",
  model_uncertain: "the model wasn't sure",
  not_in_text: "not found in the document's text",
  absent_but_mentioned: "left empty, but the document seems to show one",
};
