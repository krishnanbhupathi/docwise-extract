import { describe, expect, it } from "vitest";
import type { FieldName, InvoiceData } from "./invoice";
import { marksFor, type MarkInput } from "./marks";
import { checkInvoice } from "./rules";

const invoice: InvoiceData = {
  supplier_name: "Copperleaf Studio Ltd",
  invoice_number: "INV-2041",
  invoice_date: "2026-10-01",
  due_date: null,
  currency: "GBP",
  subtotal: "1250.00",
  tax: "250.00",
  total: "1500.00",
  line_items: [
    { description: "Design review", quantity: "10", unit_price: "100.00", amount: "1000.00" },
    { description: "Travel", quantity: null, unit_price: null, amount: "250.00" },
  ],
};

const marks = (data: InvoiceData, input: Partial<Omit<MarkInput, "rules">> = {}) => {
  const all = marksFor(data, { rules: checkInvoice(data), reasons: {}, hasText: true, edited: new Set(), ...input });
  // "✓pass ×fail" style summaries keep the expectations readable.
  return (name: FieldName) => all[name].map((m) => `${m.kind}:${m.state}`).join(" ");
};

describe("marksFor", () => {
  it("marks a consistent invoice with a text layer as vouched, extended, footed and cross-footed", () => {
    const m = marks(invoice);
    expect(m("supplier_name")).toBe("vouched:pass");
    expect(m("due_date")).toBe(""); // nothing printed, nothing to vouch
    expect(m("subtotal")).toBe("vouched:pass footed:pass crossfooted:pass");
    expect(m("tax")).toBe("vouched:pass crossfooted:pass");
    expect(m("total")).toBe("vouched:pass crossfooted:pass");
    expect(m("line_items")).toBe("vouched:pass extended:pass footed:pass");
  });

  it("fails the marks the rules and the extraction's reasons fail", () => {
    const lines = [{ ...invoice.line_items[0], amount: "1100.00" }, invoice.line_items[1]];
    const m = marks({ ...invoice, line_items: lines, total: "1550.00" }, { reasons: { invoice_number: ["not_in_text"], tax: ["model_uncertain"], due_date: ["absent_but_mentioned"] } });
    expect(m("invoice_number")).toBe("vouched:fail");
    expect(m("due_date")).toBe("vouched:fail");
    expect(m("tax")).toBe("vouched:pass crossfooted:fail unsure:fail");
    expect(m("line_items")).toBe("vouched:pass extended:fail footed:fail");
    expect(m("subtotal")).toBe("vouched:pass footed:fail crossfooted:fail");
  });

  it("leaves vouching open without a text layer, and for values a reviewer edited", () => {
    expect(marks(invoice, { hasText: false })("supplier_name")).toBe("vouched:open");
    const edited = marks(invoice, { reasons: { supplier_name: ["not_in_text", "model_uncertain"] }, edited: new Set(["supplier_name"]) });
    expect(edited("supplier_name")).toBe("vouched:open");
  });

  it("marks values nothing could use", () => {
    const m = marks({ ...invoice, invoice_date: "2026-02-30", currency: null });
    expect(m("invoice_date")).toBe("vouched:pass valid:fail");
    expect(m("currency")).toBe("valid:fail");
  });

  it("foots an untaxed invoice without a subtotal against the total", () => {
    const m = marks({ ...invoice, subtotal: null, tax: null, total: "1250.00" });
    expect(m("total")).toBe("vouched:pass footed:pass");
    expect(m("line_items")).toBe("vouched:pass extended:pass footed:pass");
  });
});
