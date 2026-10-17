import type { InvoiceData } from "./invoice";

/**
 * CSV export of approved invoices: one row per line item with the invoice's
 * fields repeated, the shape spreadsheet and bill-line importers take.
 * Amounts are plain decimals (validated before approval), so only text
 * columns can carry a formula; those are neutralised.
 */

export const CSV_COLUMNS = [
  "document_id",
  "file_name",
  "supplier_name",
  "invoice_number",
  "invoice_date",
  "due_date",
  "currency",
  "subtotal",
  "tax",
  "total",
  "line",
  "description",
  "quantity",
  "unit_price",
  "amount",
  "approval",
  "corrected",
  "approved_at",
] as const;

export type CsvInvoice = {
  id: string;
  fileName: string;
  invoice: InvoiceData;
  approval: "auto" | "review" | null;
  corrected: boolean;
  approvedAt: Date | null;
};

/**
 * A cell a spreadsheet won't run: text starting with = + - @ (or a tab or
 * carriage return) gets a leading apostrophe (OWASP's CSV injection advice).
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(invoices: CsvInvoice[]): string {
  const rows: (string | number | null)[][] = [[...CSV_COLUMNS]];
  for (const { id, fileName, invoice, approval, corrected, approvedAt } of invoices) {
    const header = [
      id,
      safeText(fileName),
      invoice.supplier_name && safeText(invoice.supplier_name),
      invoice.invoice_number && safeText(invoice.invoice_number),
      invoice.invoice_date,
      invoice.due_date,
      invoice.currency,
      invoice.subtotal,
      invoice.tax,
      invoice.total,
    ];
    const footer = [approval, corrected ? "yes" : "no", approvedAt?.toISOString() ?? null];
    // An invoice without line items still gets one row, so no approved invoice disappears from the export.
    const lines = invoice.line_items.length ? invoice.line_items : [null];
    lines.forEach((item, i) => {
      rows.push([...header, item ? i + 1 : null, item && safeText(item.description), item?.quantity ?? null, item?.unit_price ?? null, item?.amount ?? null, ...footer]);
    });
  }
  // CRLF line endings (RFC 4180) and a BOM so Excel reads UTF-8 names correctly.
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
