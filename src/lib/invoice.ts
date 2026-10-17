/**
 * The invoice shape shared by extraction, rule checks, the test-set truth
 * files and (later) the eval. Amounts and quantities are decimal strings
 * ("1234.50"), dates are ISO ("2026-10-19"), currency is an ISO 4217 code.
 * A value that isn't on the document is null.
 */

export const HEADER_FIELDS = [
  "supplier_name",
  "invoice_number",
  "invoice_date",
  "due_date",
  "currency",
  "subtotal",
  "tax",
  "total",
] as const;

export type HeaderField = (typeof HEADER_FIELDS)[number];

/** Header fields plus the line items as one unit (for rule failures, confidence and corrections). */
export type FieldName = HeaderField | "line_items";
export const FIELD_NAMES: readonly FieldName[] = [...HEADER_FIELDS, "line_items"];

export const FIELD_LABELS: Record<FieldName, string> = {
  supplier_name: "Supplier",
  invoice_number: "Invoice number",
  invoice_date: "Invoice date",
  due_date: "Due date",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  line_items: "Line items",
};

export type LineItem = {
  description: string;
  /** Null when the line has no quantity (a lump sum). */
  quantity: string | null;
  unit_price: string | null;
  amount: string;
};

export type InvoiceData = Record<HeaderField, string | null> & { line_items: LineItem[] };
