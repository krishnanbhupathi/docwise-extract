import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pdfText } from "@/extraction/prepare";
import type { ManifestEntry } from "@/testset/manifest";
import { allHigh, scoreConfidence } from "./confidence";
import { FIELD_NAMES, type InvoiceData } from "./invoice";

const invoice: InvoiceData = {
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

const text = `Copperleaf Studio Ltd  Invoice INV-2041  Date 1 October 2026  Due 31 October 2026
Design review 10 £100.00 £1,000.00   Travel £250.00
Subtotal £1,250.00  VAT 20% £250.00  Total £1,500.00`;

const lows = (scores: ReturnType<typeof scoreConfidence>) =>
  Object.fromEntries(FIELD_NAMES.filter((n) => scores[n].confidence === "low").map((n) => [n, scores[n].reasons]));

describe("scoreConfidence", () => {
  it("is high for every field when nothing argues against it", () => {
    const scores = scoreConfidence(invoice, { uncertain: [], text });
    expect(lows(scores)).toEqual({});
    expect(allHigh(scores)).toBe(true);
  });

  it("lowers the fields a rule implicates", () => {
    const scores = scoreConfidence({ ...invoice, total: "1550.00" }, { uncertain: [], text: null });
    expect(lows(scores)).toEqual({
      subtotal: ["rule:total_mismatch"],
      tax: ["rule:total_mismatch"],
      total: ["rule:total_mismatch"],
    });
  });

  it("lowers a field the model was unsure of", () => {
    expect(lows(scoreConfidence(invoice, { uncertain: [{ field: "due_date" }], text }))).toEqual({ due_date: ["model_uncertain"] });
  });

  it("lowers values that aren't printed, even when the rules pass", () => {
    const swapped = { ...invoice, invoice_number: "INV-2014", due_date: "2026-10-30" };
    expect(lows(scoreConfidence(swapped, { uncertain: [], text }))).toEqual({ invoice_number: ["not_in_text"], due_date: ["not_in_text"] });

    const misreadLine = { ...invoice, line_items: [invoice.line_items[0], { ...invoice.line_items[1], description: "Travel and lodging" }] };
    expect(lows(scoreConfidence(misreadLine, { uncertain: [], text }))).toEqual({ line_items: ["not_in_text"] });
  });

  it("lowers a field left empty that the text seems to show", () => {
    expect(lows(scoreConfidence({ ...invoice, due_date: null }, { uncertain: [], text }))).toEqual({ due_date: ["absent_but_mentioned"] });
  });

  it("accepts a split tax that is only printed as its parts", () => {
    const gst = `Subtotal 1,000.00  CGST 9% 90.00  SGST 9% 90.00  Total 1,180.00`;
    const data = { ...invoice, subtotal: "1000.00", tax: "180.00", total: "1180.00" };
    expect(scoreConfidence(data, { uncertain: [], text: gst }).tax.confidence).toBe("high");
  });

  it("skips the text check without a text layer", () => {
    const swapped = { ...invoice, invoice_number: "INV-2014" };
    expect(allHigh(scoreConfidence(swapped, { uncertain: [], text: null }))).toBe(true);
  });
});

// The text check must not flag correct values: score each tuning invoice's true values against its own PDF.
// Tuning split only: the held-out invoices are never used to adjust anything.
describe("text check on the generated tuning invoices", async () => {
  const root = path.resolve(import.meta.dirname, "../../test-set");
  const manifest: ManifestEntry[] = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  // Every tuning invoice with a text layer whose true values add up (the deliberate mismatches fail rules by design).
  const cases = manifest.filter((e) => e.split === "tuning" && e.textLayer && e.expectedRuleFailures.length === 0);

  it.each(cases.map((e) => [e.id, e] as const))("%s: true values are all high", async (_, entry) => {
    const truth: InvoiceData = JSON.parse(await readFile(path.join(root, entry.truth), "utf8"));
    const text = await pdfText(new Uint8Array(await readFile(path.join(root, entry.file))), "application/pdf");
    expect(text).not.toBeNull();
    expect(lows(scoreConfidence(truth, { uncertain: [], text }))).toEqual({});
  });
});
