import { describe, expect, it } from "vitest";
import { scoreConfidence } from "@/lib/confidence";
import type { InvoiceData } from "@/lib/invoice";
import { fieldMatches, matchLines, percentile, scoreDocument, summarize, type DocOutcome } from "./score";

const truth: InvoiceData = {
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

const outcome = (extracted: InvoiceData | null, patch: Partial<DocOutcome> = {}): DocOutcome => ({
  id: "inv-001",
  kind: "clean",
  expectedRuleFailures: [],
  route: "approved",
  extracted,
  confidence: extracted ? scoreConfidence(extracted, { uncertain: [], text: null }) : null,
  error: null,
  attempts: [{ model: "claude-opus-5-5", stopReason: "end_turn", inputTokens: 3000, outputTokens: 500, ms: 9000, fallbackUsed: false, costUsd: 0.022 }],
  ...patch,
});

describe("fieldMatches", () => {
  it("normalises amounts, currency, names and numbers", () => {
    expect(fieldMatches("total", "1500", "1500.00")).toBe(true);
    expect(fieldMatches("total", "1500.01", "1500.00")).toBe(false);
    expect(fieldMatches("currency", "gbp ", "GBP")).toBe(true);
    expect(fieldMatches("supplier_name", "copperleaf  studio LTD", "Copperleaf Studio Ltd")).toBe(true);
    expect(fieldMatches("invoice_number", "INV 2041", "INV-2041")).toBe(false);
    expect(fieldMatches("due_date", null, null)).toBe(true);
    expect(fieldMatches("due_date", "2026-10-31", null)).toBe(false);
  });
});

describe("matchLines", () => {
  it("matches lines in any order and reports missed and extra ones", () => {
    const got = [truth.line_items[1], { ...truth.line_items[0], amount: "100.00" }];
    expect(matchLines(got, truth.line_items)).toEqual({ matched: 1, extracted: 2, truth: 2, missed: [truth.line_items[0]], extra: [got[1]] });
  });
});

describe("scoreDocument", () => {
  it("counts a perfect extraction as fully correct", () => {
    const score = scoreDocument(outcome(truth), truth);
    expect(score).toMatchObject({ fullyCorrect: true, escapedFields: [], escaped: false, neededReview: false, costUsd: 0.022, ms: 9000 });
  });

  it("counts a wrong field marked high as an escaped error, and its auto-approval as an escaped document", () => {
    // A misread invoice number that no rule can catch (no text layer to check against).
    const score = scoreDocument(outcome({ ...truth, invoice_number: "INV-2014" }), truth);
    expect(score).toMatchObject({ fullyCorrect: false, escapedFields: ["invoice_number"], escaped: true, neededReview: true });
  });

  it("doesn't count wrong fields that went to review as escaped", () => {
    const wrong = { ...truth, total: "1550.00" };
    const score = scoreDocument(outcome(wrong, { route: "needs_review" }), truth);
    // The total rule flagged subtotal, tax and total: none of them are high.
    expect(score).toMatchObject({ fullyCorrect: false, escapedFields: [], escaped: false });
  });

  it("treats an invoice that doesn't add up on purpose as needing review even when read correctly", () => {
    const score = scoreDocument(outcome(truth, { route: "approved", expectedRuleFailures: ["total_mismatch"] }), truth);
    expect(score).toMatchObject({ fullyCorrect: true, neededReview: true, escaped: true });
  });

  it("scores a failed extraction as all wrong but not escaped", () => {
    const score = scoreDocument(outcome(null, { route: "failed", error: "api_error" }), truth);
    expect(score).toMatchObject({ fullyCorrect: false, escapedFields: [], escaped: false });
    expect(score.fields.due_date.correct).toBe(false);
  });
});

describe("summarize", () => {
  it("reports accuracy, line F1, review rate, escaped errors, routing and cost", () => {
    const scores = [
      scoreDocument(outcome(truth), truth),
      scoreDocument(outcome({ ...truth, invoice_number: "INV-2014" }), truth),
      scoreDocument(outcome({ ...truth, total: "1550.00" }, { route: "needs_review", kind: "scan" }), truth),
      scoreDocument(outcome(truth, { route: "needs_review", kind: "scan" }), truth),
    ];
    const m = summarize(scores);
    expect(m.documents).toBe(4);
    expect(m.fieldAccuracy.invoice_number).toBe(0.75);
    expect(m.fieldAccuracy.total).toBe(0.75);
    expect(m.headerFieldAccuracy).toBeCloseTo(30 / 32);
    expect(m.lineItems).toMatchObject({ matched: 8, extracted: 8, truth: 8, f1: 1 });
    expect(m.fullyCorrect).toEqual({ count: 2, rate: 0.5 });
    expect(m.reviewRate).toBe(0.5);
    expect(m.escapedErrors).toEqual({ fields: 1, documents: 1 });
    expect(m.routing).toEqual({ approvedCorrect: 1, approvedWrong: 1, reviewedNeeded: 1, reviewedUnneeded: 1 });
    expect(m.byKind.scan).toEqual({ documents: 2, fullyCorrect: 1, reviewed: 2, escapedFields: 0, escapedDocuments: 0 });
    expect(m.costUsd.total).toBeCloseTo(0.088);
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
    expect(percentile([], 0.5)).toBeNull();
  });
});
