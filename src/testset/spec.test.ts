import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkInvoice } from "@/lib/rules";
import type { ManifestEntry } from "./manifest";
import { generateInvoice, invoiceKind, KINDS, TEMPLATES } from "./spec";

const ALL = Array.from({ length: 60 }, (_, i) => generateInvoice(i + 1));

describe("generateInvoice", () => {
  it("is deterministic: the same number gives the same invoice", () => {
    expect(generateInvoice(7)).toEqual(generateInvoice(7));
    expect(generateInvoice(7).truth).not.toEqual(generateInvoice(8).truth);
  });

  it("produces true values that pass every rule, except the deliberate mismatches, which fail exactly one", () => {
    for (const inv of ALL) expect(checkInvoice(inv.truth).failures.map((f) => f.rule), inv.id).toEqual(inv.expectedRuleFailures);
    expect(ALL.filter((inv) => inv.expectedRuleFailures.length).map((inv) => inv.expectedRuleFailures[0])).toEqual(["total_mismatch", "line_amount_mismatch", "line_items_sum_mismatch"]);
  });

  it("matches the committed truth files (changing the generator must not change existing invoices)", () => {
    for (const inv of ALL) {
      const file = path.join(process.cwd(), "test-set", "truth", `${inv.id}.json`);
      if (existsSync(file)) expect(JSON.parse(readFileSync(file, "utf8")), inv.id).toEqual(inv.truth);
    }
  });

  it("has a hard slice of 15 with every kind in both splits", () => {
    const hard = ALL.filter((inv) => inv.kind !== "clean");
    expect(hard.map((inv) => inv.id)).toEqual(Array.from({ length: 15 }, (_, i) => `inv-0${46 + i}`));
    const counts = Object.fromEntries(KINDS.map((k) => [k, hard.filter((inv) => inv.kind === k).length]));
    expect(counts).toEqual({ clean: 0, scan: 4, photo: 3, multipage: 3, handwritten: 2, mismatch: 3 });
    for (const kind of KINDS.slice(1)) {
      const heldOut = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => invoiceKind(n) === kind && n % 3 === 0);
      expect(heldOut, kind).toHaveLength(1);
    }
    for (const inv of ALL) expect(inv.printed.notes.length > 0).toBe(inv.kind === "handwritten");
  });

  it("prints exactly the true amounts", () => {
    for (const inv of ALL) {
      expect(inv.printed.lines).toHaveLength(inv.truth.line_items.length);
      expect(inv.printed.invoiceNumber).toBe(inv.truth.invoice_number);
      expect(inv.printed.taxes.length > 0).toBe(inv.truth.tax !== null);
    }
  });

  it("covers every template, several currencies and 1 to 15 line items (30 to 40 on long invoices)", () => {
    expect(new Set(ALL.map((i) => i.template))).toEqual(new Set(TEMPLATES));
    expect(new Set(ALL.map((i) => i.truth.currency)).size).toBeGreaterThanOrEqual(8);
    const counts = ALL.filter((i) => i.kind !== "multipage").map((i) => i.truth.line_items.length);
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(15);
    for (const inv of ALL.filter((i) => i.kind === "multipage")) expect(inv.truth.line_items.length).toBeGreaterThanOrEqual(30);
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

describe("test-set/manifest.json", () => {
  const root = path.join(process.cwd(), "test-set");
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

  it("lists all 60 invoices: 40 tuning and 20 held out, 15 of them hard", () => {
    expect(manifest.map((e) => e.id)).toEqual(ALL.map((inv) => inv.id));
    expect(manifest.filter((e) => e.split === "held_out").map((e) => e.id)).toEqual(ALL.filter((_, i) => (i + 1) % 3 === 0).map((inv) => inv.id));
    expect(manifest.filter((e) => e.slice === "hard")).toHaveLength(15);
  });

  it("matches the generator and the files on disk", () => {
    for (const [i, entry] of manifest.entries()) {
      const inv = ALL[i];
      expect({ kind: entry.kind, expected: entry.expectedRuleFailures, lines: entry.lineItems }, entry.id).toEqual({ kind: inv.kind, expected: inv.expectedRuleFailures, lines: inv.truth.line_items.length });
      expect(existsSync(path.join(root, entry.file)), entry.file).toBe(true);
      expect(entry.mediaType === "image/jpeg").toBe(entry.file.endsWith(".jpg"));
      expect(entry.textLayer).toBe(["clean", "multipage", "mismatch"].includes(entry.kind));
    }
  });
});
