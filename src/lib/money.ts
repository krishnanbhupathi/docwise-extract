/**
 * Exact decimal arithmetic for amounts and quantities. Values are decimal
 * strings ("1234.50"); arithmetic happens in integer micro-units (BigInt,
 * 6 decimal places), so sums and totals compare exactly with no float error.
 */

const SCALE = 6;
const ONE = 1_000_000n;
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** "1234.5" → 1234500000n. Null if not a plain decimal or more precise than 6 places. */
export function toMicros(value: string): bigint | null {
  if (!DECIMAL.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (/[1-9]/.test(fraction.slice(SCALE))) return null;
  const micros = BigInt(whole) * ONE + BigInt(fraction.slice(0, SCALE).padEnd(SCALE, "0"));
  return negative ? -micros : micros;
}

/** 1234500000n, 2 → "1234.50" (rounded half away from zero). */
export function formatMicros(micros: bigint, digits: number): string {
  const step = 10n ** BigInt(SCALE - digits);
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs + step / 2n) / step) * step;
  const whole = rounded / ONE;
  const fraction = (rounded % ONE).toString().padStart(SCALE, "0").slice(0, digits);
  return `${negative && rounded !== 0n ? "-" : ""}${whole}${digits ? `.${fraction}` : ""}`;
}

/** a × b, both in micros, rounded half away from zero. */
export function multiplyMicros(a: bigint, b: bigint): bigint {
  const product = a * b;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + ONE / 2n) / ONE;
  return negative ? -rounded : rounded;
}

let currencies: Set<string> | undefined;

/** ISO 4217 code known to the runtime's Intl data (e.g. "EUR"; not "€" or "eur"). */
export function isIsoCurrency(code: string): boolean {
  currencies ??= new Set(Intl.supportedValuesOf("currency"));
  return /^[A-Z]{3}$/.test(code) && currencies.has(code);
}

/** Digits after the decimal point in the currency's minor unit: USD 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Size of one minor unit in micros: USD → 10000n (0.01). */
export function minorUnitMicros(currency: string): bigint {
  return 10n ** BigInt(SCALE - minorDigits(currency));
}

/** A plain decimal with thousands separators for display ("6265.70" → "6,265.70"); anything else is returned as is. */
export function groupDigits(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (match[3] ?? "");
}
