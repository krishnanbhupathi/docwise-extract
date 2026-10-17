import { describe, expect, it } from "vitest";
import type { InvoiceData } from "./invoice";
import { checkInvoice, isIsoDate } from "./rules";

const valid: InvoiceData = {
  supplier_name: "Copperleaf Studio Ltd",
  invoice_number: "INV-2041",
  invoice_date: "2026-10-01",
  due_date: "2026-10-31",
  currency: "GBP",
  subtotal: "1250.00",
  tax: "250.00",
  total: "1500.00",
  line_items: [
    { description: "Design review", quantity: "10", unit_price: "100.00", amount: "1000.00" },
    { description: "Travel", quantity: null, unit_price: null, amount: "250.00" },
  ],
};

const with_ = (patch: Partial<InvoiceData>): InvoiceData => ({ ...valid, ...patch });
const rules = (data: InvoiceData) => checkInvoice(data).failures.map((f) => f.rule);

describe("checkInvoice", () => {
  it("passes a consistent invoice", () => {
    const result = checkInvoice(valid);
    expect(result.failures).toEqual([]);
    expect(result.byField.total).toEqual([]);
  });

  it("flags missing required fields", () => {
    expect(checkInvoice(with_({ invoice_number: null, supplier_name: "  " })).byField).toMatchObject({
      invoice_number: ["missing"],
      supplier_name: ["missing"],
    });
    // Due date, subtotal and tax are optional.
    expect(rules(with_({ due_date: null }))).toEqual([]);
  });

  it("rejects impossible dates and a due date before the invoice date", () => {
    expect(rules(with_({ invoice_date: "2026-02-30" }))).toEqual(["invalid_date"]);
    expect(rules(with_({ invoice_date: "01/10/2026" }))).toEqual(["invalid_date"]);
    expect(checkInvoice(with_({ due_date: "2026-09-01" })).byField.due_date).toEqual(["due_before_invoice"]);
  });

  it("requires an ISO currency code", () => {
    expect(rules(with_({ currency: "£" }))).toEqual(["invalid_currency"]);
  });

  it("catches line items that don't add up to the subtotal", () => {
    const failure = checkInvoice(with_({ subtotal: "1350.00", total: "1600.00" })).failures[0];
    expect(failure.rule).toBe("line_items_sum_mismatch");
    expect(failure.fields).toEqual(["line_items", "subtotal"]);
    expect(failure.message).toBe("Line items add up to 1250.00, but the subtotal is 1350.00");
  });

  it("catches subtotal + tax ≠ total", () => {
    const failure = checkInvoice(with_({ total: "1499.00" })).failures[0];
    expect(failure.rule).toBe("total_mismatch");
    expect(failure.fields).toEqual(["subtotal", "tax", "total"]);
  });

  it("catches quantity × unit price ≠ amount, allowing half a minor unit of rounding", () => {
    const lines = (amount: string) => with_({
      subtotal: amount,
      tax: null,
      total: amount,
      line_items: [{ description: "Hours", quantity: "3", unit_price: "33.333", amount }],
    });
    expect(rules(lines("100.00"))).toEqual([]); // 99.999 rounds to 100.00
    expect(rules(lines("99.00"))).toEqual(["line_amount_mismatch"]);
  });

  it("checks untaxed invoices without a printed subtotal against the total", () => {
    const noSubtotal = with_({ subtotal: null, tax: null, total: "1250.00" });
    expect(rules(noSubtotal)).toEqual([]);
    expect(rules({ ...noSubtotal, total: "1200.00" })).toEqual(["line_items_sum_mismatch"]);
  });

  it("rejects amounts the currency can't express", () => {
    const yen = with_({
      currency: "JPY",
      subtotal: "1000.5",
      tax: null,
      total: "1000.5",
      line_items: [{ description: "Item", quantity: null, unit_price: null, amount: "1000.5" }],
    });
    expect(checkInvoice(yen).byField).toMatchObject({ subtotal: ["invalid_amount"], total: ["invalid_amount"], line_items: ["invalid_amount"] });
    const wholeYen = { ...yen, subtotal: "1000", total: "1000.00", line_items: [{ description: "Item", quantity: null, unit_price: null, amount: "1000" }] };
    expect(rules(wholeYen)).toEqual([]);
  });

  it("flags a quantity or unit price that isn't a number, even on its own", () => {
    const lines = [{ description: "Design review", quantity: "ten", unit_price: null, amount: "1000.00" }, valid.line_items[1]];
    expect(checkInvoice(with_({ line_items: lines })).failures).toEqual([{ rule: "invalid_amount", fields: ["line_items"], message: 'Line 1 quantity "ten" is not a number' }]);
  });

  it("flags an invoice with no line items", () => {
    expect(rules(with_({ line_items: [] }))).toEqual(["no_line_items"]);
  });
});

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("1890-01-01")).toBe(false);
  });
});
