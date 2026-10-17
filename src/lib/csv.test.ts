import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, safeText, toCsv, type CsvInvoice } from "./csv";
import type { InvoiceData } from "./invoice";

const invoice: InvoiceData = {
  supplier_name: "Copperleaf Studio, Ltd",
  invoice_number: "INV-2041",
  invoice_date: "2026-10-01",
  due_date: null,
  currency: "GBP",
  subtotal: "1250.00",
  tax: "250.00",
  total: "1500.00",
  line_items: [
    { description: 'Design review "phase 2"', quantity: "10", unit_price: "100.00", amount: "1000.00" },
    { description: "=HYPERLINK(\"http://x\")", quantity: null, unit_price: null, amount: "250.00" },
  ],
};

const entry = (patch: Partial<CsvInvoice> = {}): CsvInvoice => ({
  id: "abc123",
  fileName: "march.pdf",
  invoice,
  approval: "review",
  corrected: true,
  approvedAt: new Date("2026-10-20T10:00:00Z"),
  ...patch,
});

const parse = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("toCsv", () => {
  it("writes one row per line item with the invoice fields repeated", () => {
    const rows = parse(toCsv([entry()]));
    expect(rows[0]).toBe(CSV_COLUMNS.join(","));
    expect(rows.slice(1)).toEqual([
      'abc123,march.pdf,"Copperleaf Studio, Ltd",INV-2041,2026-10-01,,GBP,1250.00,250.00,1500.00,1,"Design review ""phase 2""",10,100.00,1000.00,review,yes,2026-10-20T10:00:00.000Z',
      `abc123,march.pdf,"Copperleaf Studio, Ltd",INV-2041,2026-10-01,,GBP,1250.00,250.00,1500.00,2,"'=HYPERLINK(""http://x"")",,,250.00,review,yes,2026-10-20T10:00:00.000Z`,
    ]);
  });

  it("keeps an invoice without line items as one row", () => {
    const rows = parse(toCsv([entry({ invoice: { ...invoice, line_items: [] }, approval: "auto", corrected: false })]));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe('abc123,march.pdf,"Copperleaf Studio, Ltd",INV-2041,2026-10-01,,GBP,1250.00,250.00,1500.00,,,,,,auto,no,2026-10-20T10:00:00.000Z');
  });

  it("starts with a BOM and ends rows with CRLF", () => {
    const csv = toCsv([]);
    expect(csv.startsWith("﻿document_id,")).toBe(true);
    expect(csv.endsWith("approved_at\r\n")).toBe(true);
  });
});

describe("safeText", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"]) expect(safeText(value)).toBe(`'${value}`);
    expect(safeText("Design review")).toBe("Design review");
  });
});
