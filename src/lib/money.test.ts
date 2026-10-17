import { describe, expect, it } from "vitest";
import { formatMicros, isIsoCurrency, minorDigits, multiplyMicros, toMicros } from "./money";

describe("toMicros", () => {
  it("parses plain decimals exactly", () => {
    expect(toMicros("1234.5")).toBe(1_234_500_000n);
    expect(toMicros("0.01")).toBe(10_000n);
    expect(toMicros("-12.30")).toBe(-12_300_000n);
    expect(toMicros("7")).toBe(7_000_000n);
  });

  it("rejects formatted or ambiguous values", () => {
    for (const bad of ["1,234.50", "1.234,50", "$12", "12.", ".5", "", "1e3", "12.3.4"]) expect(toMicros(bad)).toBeNull();
  });

  it("accepts trailing zeros past six places but not real extra precision", () => {
    expect(toMicros("1.00000000")).toBe(1_000_000n);
    expect(toMicros("1.0000001")).toBeNull();
  });
});

describe("formatMicros", () => {
  it("formats to the currency's digits, rounding half away from zero", () => {
    expect(formatMicros(1_234_500_000n, 2)).toBe("1234.50");
    expect(formatMicros(1_005_000n, 2)).toBe("1.01");
    expect(formatMicros(-1_005_000n, 2)).toBe("-1.01");
    expect(formatMicros(1_500_000_000n, 0)).toBe("1500");
    expect(formatMicros(1_234_567n, 3)).toBe("1.235");
  });
});

describe("multiplyMicros", () => {
  it("multiplies quantity by price", () => {
    expect(multiplyMicros(toMicros("2.5")!, toMicros("80.00")!)).toBe(toMicros("200")!);
    expect(multiplyMicros(toMicros("3")!, toMicros("0.333333")!)).toBe(toMicros("0.999999")!);
  });
});

describe("currencies", () => {
  it("knows ISO codes and their minor units", () => {
    expect(isIsoCurrency("EUR")).toBe(true);
    expect(isIsoCurrency("INR")).toBe(true);
    expect(isIsoCurrency("eur")).toBe(false);
    expect(isIsoCurrency("€")).toBe(false);
    expect(isIsoCurrency("XYZ")).toBe(false);
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });
});
