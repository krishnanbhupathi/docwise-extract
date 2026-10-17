import { describe, expect, it } from "vitest";
import {
  currencyAppears,
  dateAppears,
  datesIn,
  dueDateMentioned,
  indexText,
  numberAppears,
  numberReadings,
  phraseAppears,
  subtotalMentioned,
  taxMentioned,
  wordsAppear,
} from "./text-check";
import { toMicros } from "./money";

const micros = (values: string[]) => values.map((v) => toMicros(v));

describe("numberReadings", () => {
  it("reads both separator conventions", () => {
    expect(numberReadings("1,234.56")).toEqual(micros(["1234.56"]));
    expect(numberReadings("1.234,56")).toEqual(micros(["1234.56"]));
    expect(numberReadings("1'234.50")).toEqual(micros(["1234.50"]));
    expect(numberReadings("12,34,567.00")).toEqual(micros(["1234567.00"])); // Indian grouping
  });

  it("keeps every reading of an ambiguous number", () => {
    expect(numberReadings("1,234")).toEqual(micros(["1234", "1.234"]));
    expect(numberReadings("1.234")).toEqual(micros(["1.234", "1234"]));
    expect(numberReadings("12,50")).toEqual(micros(["1250", "12.50"]));
    expect(numberReadings("1.234.567")).toEqual(micros(["1234567"]));
  });
});

describe("datesIn", () => {
  it("reads ISO, numeric and written dates", () => {
    expect([...datesIn("Invoice date 2026-10-19")]).toEqual(["2026-10-19"]);
    expect([...datesIn("19 October 2026")]).toEqual(["2026-10-19"]);
    expect([...datesIn("Oct 19, 2026")]).toEqual(["2026-10-19"]);
    expect([...datesIn("2026年10月19日")]).toEqual(["2026-10-19"]);
  });

  it("indexes both readings of a numeric date, and only real dates", () => {
    expect([...datesIn("03/04/2026")].sort()).toEqual(["2026-03-04", "2026-04-03"]);
    expect([...datesIn("19.10.2026")]).toEqual(["2026-10-19"]);
    expect([...datesIn("31/02/2026")]).toEqual([]);
  });
});

describe("matching values against the text", () => {
  const index = indexText(`
    T A X   I N V O I C E
    Brightfield Analytics GmbH     Rechnung Nr. RE-2026/0412
    Datum: 19.10.2026   Fällig am: 18.11.2026
    Cloud   hosting – October      3     1.250,00 €     3.750,00 €
    Zwischensumme 3.750,00 €   MwSt. 19 %  712,50 €   Gesamt 4.462,50 €
  `);

  it("finds amounts by value whatever the format", () => {
    expect(numberAppears("4462.50", index)).toBe(true);
    expect(numberAppears("712.5", index)).toBe(true);
    expect(numberAppears("-3750.00", index)).toBe(true); // credit lines ignore the sign
    expect(numberAppears("4462.05", index)).toBe(false);
  });

  it("finds names and codes, including letter-spaced ones", () => {
    expect(phraseAppears("Brightfield Analytics GmbH", index)).toBe(true);
    expect(phraseAppears("RE-2026/0412", index)).toBe(true);
    expect(phraseAppears("Tax Invoice", index)).toBe(true);
    expect(phraseAppears("Brightfield Analytics Ltd", index)).toBe(false);
  });

  it("finds descriptions word by word", () => {
    expect(wordsAppear("Cloud hosting — October", index)).toBe(true);
    expect(wordsAppear("Cloud hosting November", index)).toBe(false);
  });

  it("finds dates and currencies", () => {
    expect(dateAppears("2026-10-19", index)).toBe(true);
    expect(dateAppears("2026-11-18", index)).toBe(true);
    expect(dateAppears("2026-10-18", index)).toBe(false);
    expect(currencyAppears("EUR", index)).toBe(true);
    expect(currencyAppears("GBP", index)).toBe(false);
    expect(currencyAppears("USD", indexText("Total due: US$ 120.00"))).toBe(true);
    expect(currencyAppears("INR", indexText("Grand total ₹ 1,20,000.00"))).toBe(true);
  });

  it("notices fields the model may have missed", () => {
    expect(taxMentioned(indexText("VAT 20% 50.00"))).toBe(true);
    expect(taxMentioned(indexText("Total 250.00"))).toBe(false);
    expect(taxMentioned(indexText("Sales tax (6%) $483.48"))).toBe(true);
    expect(taxMentioned(indexText("VAT Reg. No. GB 123 4567 89   Total £250.00"))).toBe(false);
    expect(taxMentioned(indexText("TAX INVOICE  Invoice No. 2041"))).toBe(false);
    expect(dueDateMentioned(indexText("Payment due: 30 Nov 2026"))).toBe(true);
    expect(dueDateMentioned(indexText("Due on receipt"))).toBe(false);
    expect(subtotalMentioned(indexText("Sub-total 250.00"))).toBe(true);
    expect(subtotalMentioned(indexText("Total 250.00"))).toBe(false);
  });
});
