import { toMicros } from "./money";
import { isIsoDate } from "./rules";

/**
 * "Does this value actually appear on the document?" for PDFs with a text
 * layer. The model can misread, but it shouldn't produce an amount, date or
 * name that isn't printed anywhere; when it does, the field is not trusted.
 *
 * Numbers and dates are compared by value, not by spelling: the index holds
 * every reading of every number ("1.234,56" and "1,234.56" both index
 * 1234.56; "1,234" indexes both 1234 and 1.234) and every reading of every
 * date (03/04/2026 indexes 3 April and 4 March). That keeps false alarms
 * near zero; telling apart readings the text itself can't settle (which
 * convention a date uses) is left to the model's own uncertainty.
 */

export type TextIndex = {
  /** Lowercased, quotes and dashes unified, whitespace collapsed. */
  flat: string;
  /** `flat` without any whitespace (letter-spaced headings, wrapped names). */
  compact: string;
  /** Absolute value of every number reading, in micro-units. */
  numbers: Set<bigint>;
  /** Every ISO date the text can be read as. */
  dates: Set<string>;
  words: Set<string>;
};

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const pad = (n: number) => String(n).padStart(2, "0");

/** Every ISO date a piece of text can be read as. */
export function datesIn(text: string): Set<string> {
  const found = new Set<string>();
  const add = (y: number, m: number, d: number) => {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    if (isIsoDate(iso)) found.add(iso);
  };
  for (const [, y, m, d] of text.matchAll(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/g)) add(+y, +m, +d);
  for (const [, a, b, y] of text.matchAll(/(?<!\d)(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})(?!\d)/g)) {
    add(+y, +b, +a); // day first
    add(+y, +a, +b); // month first
  }
  for (const [, d, mon, y] of text.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?,?\\s+(\\d{4})`, "gi"))) add(+y, MONTHS[mon.toLowerCase()], +d);
  for (const [, mon, d, y] of text.matchAll(new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "gi"))) add(+y, MONTHS[mon.toLowerCase()], +d);
  return found;
}

/** Every value a printed number can stand for: "1.234,56" → 1234.56; "1,234" → 1234 and 1.234. */
export function numberReadings(token: string): bigint[] {
  const t = token.replace(/['   ]/g, "");
  const candidates = new Set<string>();
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    const decimal = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    candidates.add(t.split(grouping).join("").replace(decimal, "."));
  } else if (hasComma) {
    candidates.add(t.replace(/,/g, ""));
    if (t.split(",").length === 2) candidates.add(t.replace(",", "."));
  } else if (hasDot) {
    if (t.split(".").length === 2) candidates.add(t);
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) candidates.add(t.replace(/\./g, ""));
  } else {
    candidates.add(t);
  }
  const out: bigint[] = [];
  for (const c of candidates) {
    const micros = toMicros(c);
    if (micros !== null) out.push(micros);
  }
  return out;
}

export function indexText(text: string): TextIndex {
  const flat = normalizeText(text);
  const numbers = new Set<bigint>();
  // Plain tokens ("1,234.56", "1.234,56", "1'234.50") and space-grouped ones ("1 234,56").
  const tokens = [...flat.matchAll(/\d[\d.,']*\d|\d/g), ...flat.matchAll(/\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?/g)];
  for (const [token] of tokens) for (const n of numberReadings(token)) numbers.add(n);
  return {
    flat,
    compact: flat.replace(/\s/g, ""),
    numbers,
    dates: datesIn(text),
    words: new Set(flat.split(/[^\p{L}\p{N}]+/u).filter(Boolean)),
  };
}

/** Symbols that can stand for a currency on the page ("$" is several currencies; the model's choice among them isn't checkable here). */
const SYMBOLS: Record<string, string[]> = {
  USD: ["$"],
  EUR: ["€"],
  GBP: ["£"],
  INR: ["₹", "rs.", "rupees"],
  JPY: ["¥", "円"],
  CNY: ["¥", "元"],
  AUD: ["$"],
  CAD: ["$"],
  SGD: ["$"],
  NZD: ["$"],
  HKD: ["$"],
  CHF: ["fr."],
};

/** A plain decimal string appears as a printed number (sign ignored: credit lines print "(12.00)" or "12.00-"). */
export function numberAppears(value: string, index: TextIndex): boolean {
  const micros = toMicros(value);
  if (micros === null) return false;
  return index.numbers.has(micros < 0n ? -micros : micros);
}

/** A name or code appears, allowing for letter-spaced or line-wrapped text. */
export function phraseAppears(value: string, index: TextIndex): boolean {
  const phrase = normalizeText(value);
  return phrase.length > 0 && (index.flat.includes(phrase) || index.compact.includes(phrase.replace(/\s/g, "")));
}

/** Every word of a description appears somewhere (table columns can interleave wrapped cells). */
export function wordsAppear(value: string, index: TextIndex): boolean {
  const words = normalizeText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  return words.every((w) => index.words.has(w) || index.compact.includes(w));
}

export function currencyAppears(code: string, index: TextIndex): boolean {
  if (new RegExp(`\\b${code.toLowerCase()}\\b`).test(index.flat)) return true;
  return (SYMBOLS[code] ?? []).some((symbol) => index.flat.includes(symbol));
}

export function dateAppears(value: string, index: TextIndex): boolean {
  return index.dates.has(value);
}

/** True if a date is printed shortly after "due" / "payable by" (so a null due date was probably missed). */
export function dueDateMentioned(index: TextIndex): boolean {
  for (const match of index.flat.matchAll(/\b(due date|due on|due by|payment due|payable by|due)\b/g)) {
    const start = match.index! + match[0].length;
    if (datesIn(index.flat.slice(start, start + 24)).size > 0) return true;
  }
  return false;
}

/** True if the text names a tax (so a null tax was probably missed). */
export function taxMentioned(index: TextIndex): boolean {
  return /\b(tax|vat|gst|cgst|sgst|igst|hst|pst|mwst|tva|iva|ust|btw)\b/.test(index.flat);
}

/** True if a number is printed shortly after "subtotal" (so a null subtotal was probably missed). */
export function subtotalMentioned(index: TextIndex): boolean {
  for (const match of index.flat.matchAll(/\b(sub-? ?total|net amount|net total|taxable value)\b/g)) {
    const start = match.index! + match[0].length;
    if (/\d/.test(index.flat.slice(start, start + 24))) return true;
  }
  return false;
}
