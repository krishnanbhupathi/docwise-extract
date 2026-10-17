import { FIELD_NAMES, type FieldName, type InvoiceData } from "./invoice";
import { formatMicros, isIsoCurrency, minorDigits, minorUnitMicros, multiplyMicros, toMicros } from "./money";

/**
 * Business rules run on every extraction. They catch values that can't be
 * right (a date that doesn't exist, totals that don't add up), whether the
 * model misread them or the invoice itself is wrong; either way a person
 * should look. Each failure names the fields it implicates.
 */

export type RuleCode =
  | "missing"
  | "invalid_date"
  | "due_before_invoice"
  | "invalid_currency"
  | "invalid_amount"
  | "no_line_items"
  | "line_amount_mismatch"
  | "line_items_sum_mismatch"
  | "total_mismatch";

export type RuleFailure = { rule: RuleCode; fields: FieldName[]; message: string };

export type RuleResult = { failures: RuleFailure[]; byField: Record<FieldName, RuleCode[]> };

const REQUIRED = ["supplier_name", "invoice_number", "invoice_date", "currency", "total"] as const;

/** A real calendar date in ISO form, within a sane range for an invoice. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1990 && year <= 2100 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function checkInvoice(data: InvoiceData): RuleResult {
  const failures: RuleFailure[] = [];
  const fail = (rule: RuleCode, fields: FieldName[], message: string) => failures.push({ rule, fields, message });

  for (const field of REQUIRED) if (!data[field]?.trim()) fail("missing", [field], "Not found on the invoice");

  for (const field of ["invoice_date", "due_date"] as const) {
    const value = data[field];
    if (value && !isIsoDate(value)) fail("invalid_date", [field], `"${value}" is not a valid date`);
  }
  if (data.invoice_date && data.due_date && isIsoDate(data.invoice_date) && isIsoDate(data.due_date) && data.due_date < data.invoice_date) {
    fail("due_before_invoice", ["invoice_date", "due_date"], "Due date is before the invoice date");
  }

  const currency = data.currency && isIsoCurrency(data.currency) ? data.currency : null;
  if (data.currency && !currency) fail("invalid_currency", ["currency"], `"${data.currency}" is not an ISO 4217 currency code`);
  const digits = currency ? minorDigits(currency) : 2;
  const unit = currency ? minorUnitMicros(currency) : 10_000n;
  const show = (micros: bigint) => formatMicros(micros, digits);

  // An amount must be a decimal that the currency can actually express (no 0.5 yen).
  const amount = (value: string | null, field: FieldName, what: string): bigint | null => {
    if (value === null) return null;
    const micros = toMicros(value);
    if (micros === null || micros % unit !== 0n) {
      // Header messages are shown after the field's label; line messages name their line.
      fail("invalid_amount", [field], `${field === "line_items" ? `${what} ` : ""}"${value}" is not a valid${currency ? ` ${currency}` : ""} amount`);
      return null;
    }
    return micros;
  };
  const subtotal = amount(data.subtotal, "subtotal", "Subtotal");
  const tax = amount(data.tax, "tax", "Tax");
  const total = amount(data.total, "total", "Total");

  if (data.line_items.length === 0) {
    fail("no_line_items", ["line_items"], "No line items found");
  } else {
    let sum: bigint | null = 0n;
    const mismatched: number[] = [];
    data.line_items.forEach((item, i) => {
      const lineAmount = amount(item.amount, "line_items", `Line ${i + 1} amount`);
      if (lineAmount === null) {
        sum = null;
        return;
      }
      if (sum !== null) sum += lineAmount;
      const number = (value: string | null, what: string) => {
        if (value === null) return null;
        const micros = toMicros(value);
        if (micros === null) fail("invalid_amount", ["line_items"], `Line ${i + 1} ${what} "${value}" is not a number`);
        return micros;
      };
      const quantity = number(item.quantity, "quantity");
      const price = number(item.unit_price, "unit price");
      if (quantity !== null && price !== null) {
        const diff = multiplyMicros(quantity, price) - lineAmount;
        // Allow the half-unit of rounding a correct invoice can show.
        if ((diff < 0n ? -diff : diff) * 2n > unit) mismatched.push(i + 1);
      }
    });
    if (mismatched.length) {
      fail("line_amount_mismatch", ["line_items"], `Quantity × unit price doesn't match the amount on line${mismatched.length > 1 ? "s" : ""} ${mismatched.join(", ")}`);
    }
    // Without a printed subtotal, an untaxed invoice's lines should add up to the total.
    const target = subtotal ?? (data.tax === null ? total : null);
    const targetField: FieldName = subtotal !== null ? "subtotal" : "total";
    if (sum !== null && target !== null && sum !== target) {
      fail("line_items_sum_mismatch", ["line_items", targetField], `Line items add up to ${show(sum)}, but the ${targetField} is ${show(target)}`);
    }
  }

  if (subtotal !== null && total !== null && data.tax !== null && tax === null) {
    // The tax amount itself was invalid; already reported.
  } else if (subtotal !== null && total !== null && subtotal + (tax ?? 0n) !== total) {
    fail("total_mismatch", ["subtotal", "tax", "total"], `Subtotal ${show(subtotal)} + tax ${show(tax ?? 0n)} = ${show(subtotal + (tax ?? 0n))}, but the total is ${show(total)}`);
  }

  const byField = Object.fromEntries(FIELD_NAMES.map((f) => [f, [] as RuleCode[]])) as Record<FieldName, RuleCode[]>;
  for (const failure of failures) for (const field of failure.fields) if (!byField[field].includes(failure.rule)) byField[field].push(failure.rule);
  return { failures, byField };
}
