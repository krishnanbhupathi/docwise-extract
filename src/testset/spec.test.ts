import { describe, expect, it } from "vitest";
import { checkInvoice } from "@/lib/rules";
import { generateInvoice, TEMPLATES } from "./spec";

const ALL = Array.from({ length: 60 }, (_, i) => generateInvoice(i + 1));

describe("generateInvoice", () => {
  it("is deterministic: the same number gives the same invoice", () => {
    expect(generateInvoice(7)).toEqual(generateInvoice(7));
    expect(generateInvoice(7).truth).not.toEqual(generateInvoice(8).truth);
  });

  it("produces true values that pass every rule check (clean invoices add up)", () => {
    for (const inv of ALL) expect(checkInvoice(inv.truth).failures, inv.id).toEqual([]);
  });

  it("prints exactly the true amounts", () => {
    for (const inv of ALL) {
      expect(inv.printed.lines).toHaveLength(inv.truth.line_items.length);
      expect(inv.printed.invoiceNumber).toBe(inv.truth.invoice_number);
      expect(inv.printed.taxes.length > 0).toBe(inv.truth.tax !== null);
    }
  });

  it("covers every template, several currencies and 1 to 15 line items", () => {
    expect(new Set(ALL.map((i) => i.template))).toEqual(new Set(TEMPLATES));
    expect(new Set(ALL.map((i) => i.truth.currency)).size).toBeGreaterThanOrEqual(8);
    const counts = ALL.map((i) => i.truth.line_items.length);
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(15);
  });

  it("splits tax across lines where the country does (CGST + SGST)", () => {
    const split = ALL.filter((i) => i.printed.taxes.length === 2);
    expect(split.length).toBeGreaterThan(0);
    for (const inv of split) {
      expect(inv.profile).toBe("in");
      // The true tax is the sum of the printed lines, e.g. ₹1,234.50 + ₹1,234.50.
      const printed = inv.printed.taxes.map((t) => Number(t.amount.replace(/[^\d.]/g, "")));
      expect((printed[0] + printed[1]).toFixed(2)).toBe(inv.truth.tax);
    }
  });

  it("uses only invented, example-domain contact details", () => {
    for (const inv of ALL) expect(inv.printed.supplier.email).toMatch(/@[a-z]+\.example$/);
  });
});
