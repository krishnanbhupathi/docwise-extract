import type { InvoiceData, LineItem } from "@/lib/invoice";
import { formatMicros, minorDigits, multiplyMicros, toMicros } from "@/lib/money";
import type { RuleCode } from "@/lib/rules";
import { seeded, type Random } from "./random";

/**
 * Builds one synthetic invoice from a seed: the true values (what an
 * extraction should return, as InvoiceData) and the printed view a template
 * renders. Every company, person and address is invented. Countries differ in
 * the ways real invoices do: currency symbols, number grouping (1.234,56 /
 * 1,23,456.00 / 1’234.50), date order, tax names and how tax is split.
 */

export const TEMPLATES = ["classic", "modern", "minimal", "gst", "studio"] as const;

/**
 * What makes an invoice hard. Clean invoices are crisp PDFs with a text
 * layer. The hard slice (46–60) adds what real inboxes contain: scans (an
 * image-only PDF, tilted, blurred, low contrast), phone photos (JPEG, at an
 * angle, on a desk, with shadow), long invoices over several pages,
 * handwritten notes on a scanned printout, and invoices that don't add up.
 */
export const KINDS = ["clean", "scan", "photo", "multipage", "handwritten", "mismatch"] as const;
export type InvoiceKind = (typeof KINDS)[number];

// Every third invoice is held out (48, 51, 54, 57, 60), one of each hard kind.
const HARD: Record<number, InvoiceKind> = {
  46: "scan", 47: "scan", 48: "scan", 49: "photo", 50: "photo", 51: "photo", 52: "multipage", 53: "multipage",
  54: "multipage", 55: "handwritten", 56: "mismatch", 57: "handwritten", 58: "mismatch", 59: "scan", 60: "mismatch",
};

export const invoiceKind = (n: number): InvoiceKind => HARD[n] ?? "clean";

/** How each deliberately inconsistent invoice is wrong; its true values are what's printed. */
const MISMATCH: Record<number, { error: "total" | "line" | "sum"; rule: RuleCode }> = {
  56: { error: "total", rule: "total_mismatch" }, // two digits of the total transposed
  58: { error: "line", rule: "line_amount_mismatch" }, // one line billed for one unit more than its quantity
  60: { error: "sum", rule: "line_items_sum_mismatch" }, // the subtotal leaves out the last line
};
export type TemplateName = (typeof TEMPLATES)[number];

type TaxLine = { label: string; rate: number };

type Profile = {
  key: string;
  currency: string;
  paper: "A4" | "Letter";
  /** Printed amount, e.g. "1.234,56 €". */
  money: (value: string) => string;
  dates: Array<(d: Date) => string>;
  /** Each option is the tax lines an invoice shows; [] means no tax. */
  taxes: TaxLine[][];
  suffixes: string[];
  cities: string[];
  taxId: (r: Random) => string;
  taxIdLabel: string;
  numbers: Array<(r: Random, year: number) => string>;
  /** Printed when the symbol alone doesn't name the currency ("$"). */
  currencyNote?: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const d = (date: Date) => ({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, day: date.getUTCDate() });

const grouped = (locale: string, digits: number) => (value: string) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));

const digitsRun = (r: Random, n: number) => Array.from({ length: n }, () => r.int(0, 9)).join("");

const PROFILES: Record<string, Profile> = {
  us: {
    key: "us",
    currency: "USD",
    paper: "Letter",
    money: (v) => `$${grouped("en-US", 2)(v)}`,
    dates: [(x) => `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`, (x) => `${pad(d(x).m)}/${pad(d(x).day)}/${d(x).y}`],
    taxes: [[{ label: "Sales tax (8.25%)", rate: 0.0825 }], [{ label: "Sales tax (6%)", rate: 0.06 }], []],
    suffixes: ["LLC", "Inc.", "Co."],
    cities: ["Columbus, OH 43215", "Portland, OR 97204", "Austin, TX 78701", "Raleigh, NC 27601", "Madison, WI 53703"],
    taxId: (r) => `${r.int(10, 99)}-${digitsRun(r, 7)}`,
    taxIdLabel: "EIN",
    numbers: [(r) => `INV-${r.int(1000, 9999)}`, (r, y) => `${y}-${pad(r.int(1, 999), 4)}`],
  },
  eu: {
    key: "eu",
    currency: "EUR",
    paper: "A4",
    money: (v) => `${grouped("de-DE", 2)(v)} €`,
    dates: [(x) => `${pad(d(x).day)}.${pad(d(x).m)}.${d(x).y}`],
    taxes: [[{ label: "VAT 19%", rate: 0.19 }], [{ label: "VAT 21%", rate: 0.21 }], [{ label: "VAT 20%", rate: 0.2 }]],
    suffixes: ["GmbH", "B.V.", "SARL"],
    cities: ["10115 Berlin", "1012 Amsterdam", "69002 Lyon", "80331 München", "3011 Rotterdam"],
    taxId: (r) => `DE${digitsRun(r, 9)}`,
    taxIdLabel: "VAT ID",
    numbers: [(r, y) => `RE-${y}-${r.int(1000, 9999)}`, (r, y) => `${y}/${pad(r.int(1, 999), 3)}`],
  },
  uk: {
    key: "uk",
    currency: "GBP",
    paper: "A4",
    money: (v) => `£${grouped("en-GB", 2)(v)}`,
    dates: [(x) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`, (x) => `${pad(d(x).day)}/${pad(d(x).m)}/${d(x).y}`],
    taxes: [[{ label: "VAT @ 20%", rate: 0.2 }], [{ label: "VAT @ 5%", rate: 0.05 }], []],
    suffixes: ["Ltd", "Ltd", "LLP"],
    cities: ["Leeds LS1 4DY", "Bristol BS1 5TR", "Manchester M1 3HU", "Norwich NR2 1BH", "Cardiff CF10 1EP"],
    taxId: (r) => `GB ${digitsRun(r, 3)} ${digitsRun(r, 4)} ${digitsRun(r, 2)}`,
    taxIdLabel: "VAT Reg. No.",
    numbers: [(r) => `${r.pick(["INV", "SI"])}${pad(r.int(1, 9999), 5)}`, (r) => `#${pad(r.int(1, 9999), 6)}`],
  },
  in: {
    key: "in",
    currency: "INR",
    paper: "A4",
    money: (v) => `₹${grouped("en-IN", 2)(v)}`,
    dates: [(x) => `${pad(d(x).day)}-${pad(d(x).m)}-${d(x).y}`, (x) => `${pad(d(x).day)}/${pad(d(x).m)}/${d(x).y}`, (x) => `${pad(d(x).day)} ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${d(x).y}`],
    taxes: [
      [{ label: "CGST @ 9%", rate: 0.09 }, { label: "SGST @ 9%", rate: 0.09 }],
      [{ label: "IGST @ 18%", rate: 0.18 }],
      [{ label: "CGST @ 6%", rate: 0.06 }, { label: "SGST @ 6%", rate: 0.06 }],
    ],
    suffixes: ["Pvt. Ltd.", "LLP", "Enterprises"],
    cities: ["Pune, Maharashtra 411001", "Kochi, Kerala 682011", "Jaipur, Rajasthan 302001", "Hyderabad, Telangana 500081", "Indore, Madhya Pradesh 452001"],
    taxId: (r) => `${pad(r.int(1, 37))}AAB${r.pick(["C", "F", "P"])}${digitsRun(r, 4)}${r.pick(["K", "M", "Q"])}1Z${r.int(1, 9)}`,
    taxIdLabel: "GSTIN",
    numbers: [(r, y) => `${r.pick(["TI", "INV"])}/${y % 100}-${(y % 100) + 1}/${pad(r.int(1, 999), 4)}`, (r) => `GST-${r.int(10000, 99999)}`],
  },
  au: {
    key: "au",
    currency: "AUD",
    paper: "A4",
    money: (v) => `$${grouped("en-AU", 2)(v)}`,
    dates: [(x) => `${pad(d(x).day)}/${pad(d(x).m)}/${d(x).y}`],
    taxes: [[{ label: "GST (10%)", rate: 0.1 }]],
    suffixes: ["Pty Ltd"],
    cities: ["Brisbane QLD 4000", "Hobart TAS 7000", "Geelong VIC 3220"],
    taxId: (r) => `${r.int(10, 99)} ${digitsRun(r, 3)} ${digitsRun(r, 3)} ${digitsRun(r, 3)}`,
    taxIdLabel: "ABN",
    numbers: [(r) => `INV-${pad(r.int(1, 9999), 5)}`],
    currencyNote: "All amounts in Australian dollars (AUD).",
  },
  ca: {
    key: "ca",
    currency: "CAD",
    paper: "Letter",
    money: (v) => `$${grouped("en-CA", 2)(v)}`,
    dates: [(x) => `${d(x).y}-${pad(d(x).m)}-${pad(d(x).day)}`],
    taxes: [[{ label: "GST 5%", rate: 0.05 }], [{ label: "HST 13%", rate: 0.13 }]],
    suffixes: ["Inc.", "Ltd."],
    cities: ["Halifax, NS B3H 1A1", "Winnipeg, MB R3C 0A5", "Victoria, BC V8W 1P6"],
    taxId: (r) => `${digitsRun(r, 9)} RT0001`,
    taxIdLabel: "GST/HST No.",
    numbers: [(r) => `${r.int(10000, 99999)}`],
    currencyNote: "Amounts in Canadian dollars (CAD).",
  },
  jp: {
    key: "jp",
    currency: "JPY",
    paper: "A4",
    money: (v) => `¥${grouped("en-US", 0)(v)}`,
    dates: [(x) => `${d(x).y}/${pad(d(x).m)}/${pad(d(x).day)}`],
    taxes: [[{ label: "Consumption tax (10%)", rate: 0.1 }]],
    suffixes: ["K.K.", "Co., Ltd."],
    cities: ["Fukuoka 810-0001", "Sendai 980-0811", "Kyoto 600-8216"],
    taxId: (r) => `T${digitsRun(r, 13)}`,
    taxIdLabel: "Registration No.",
    numbers: [(r, y) => `${y}${pad(r.int(1, 12))}-${pad(r.int(1, 999), 3)}`],
  },
  ch: {
    key: "ch",
    currency: "CHF",
    paper: "A4",
    money: (v) => `CHF ${grouped("de-CH", 2)(v)}`,
    dates: [(x) => `${pad(d(x).day)}.${pad(d(x).m)}.${d(x).y}`],
    taxes: [[{ label: "MWST 8.1%", rate: 0.081 }]],
    suffixes: ["AG", "GmbH"],
    cities: ["8001 Zürich", "3011 Bern", "6003 Luzern"],
    taxId: (r) => `CHE-${digitsRun(r, 3)}.${digitsRun(r, 3)}.${digitsRun(r, 3)} MWST`,
    taxIdLabel: "UID",
    numbers: [(r) => `R-${r.int(100000, 999999)}`],
  },
  sg: {
    key: "sg",
    currency: "SGD",
    paper: "A4",
    money: (v) => `S$${grouped("en-SG", 2)(v)}`,
    dates: [(x) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${x.getUTCFullYear()}`],
    taxes: [[{ label: "GST 9%", rate: 0.09 }]],
    suffixes: ["Pte. Ltd."],
    cities: ["Singapore 049315", "Singapore 238874", "Singapore 018989"],
    taxId: (r) => `${r.int(199000000, 202699999)}${r.pick(["K", "M", "W"])}`,
    taxIdLabel: "GST Reg. No.",
    numbers: [(r, y) => `SG-${y}-${pad(r.int(1, 9999), 4)}`],
  },
};

const STUDIO_PROFILES = ["au", "ca", "jp", "ch", "sg"] as const;
const TEMPLATE_PROFILE: Record<Exclude<TemplateName, "studio">, string> = { classic: "us", modern: "eu", minimal: "uk", gst: "in" };

type Category = { items: string[]; quantity: "count" | "hours" | "people"; price: [number, number] };

const CATALOG: Record<string, Category> = {
  office: {
    items: ["A4 copier paper, 80 gsm (box of 5 reams)", "Toner cartridge, black", "Ballpoint pens (pack of 50)", "Lever arch files (pack of 10)", "Whiteboard markers (set of 8)", "Sticky notes, 76 × 76 mm (12 pads)", "Ergonomic office chair", "Monitor stand", "Shredder bags (roll of 50)", "Desk lamp, LED"],
    quantity: "count",
    price: [3, 320],
  },
  services: {
    items: ["Strategy workshop", "User research interviews", "Front-end development", "Project management", "QA testing", "Copywriting", "Data migration", "Accessibility audit", "Design review", "Staff training session"],
    quantity: "hours",
    price: [60, 220],
  },
  hardware: {
    items: ["27-inch 4K monitor", "Laptop docking station", "Wireless keyboard and mouse set", "Network switch, 24-port", "Wi-Fi access point", "UPS battery backup, 1500 VA", "Label printer", "USB-C cables, 2 m (pack of 5)"],
    quantity: "count",
    price: [15, 1400],
  },
  catering: {
    items: ["Breakfast buffet (per person)", "Working lunch (per person)", "Coffee and tea service (per person)", "Afternoon pastries (per person)", "Fresh fruit platter (serves 10)"],
    quantity: "people",
    price: [4, 60],
  },
  software: {
    items: ["Team plan seat (monthly)", "Cloud storage, 1 TB (monthly)", "Design tool licence (annual)", "Password manager seat (annual)", "Video conferencing seat (monthly)", "Backup service (monthly)"],
    quantity: "count",
    price: [5, 180],
  },
  logistics: {
    items: ["Courier, same day", "Pallet delivery", "Warehouse storage (per pallet per week)", "Packaging materials", "Customs handling fee"],
    quantity: "count",
    price: [8, 260],
  },
};

const LUMP_SUMS = ["Delivery", "Setup fee", "Travel expenses", "Rush handling", "Installation"];

/** Rough price level per currency, so amounts look local (¥ and ₹ are much larger numbers). */
const PRICE_SCALE: Record<string, number> = { USD: 1, EUR: 0.95, GBP: 0.8, INR: 85, AUD: 1.5, CAD: 1.4, JPY: 150, CHF: 0.9, SGD: 1.35 };

const PREFIXES = ["Copperleaf", "Brightfield", "Harbour & Pine", "Northwind Lane", "Silverbirch", "Kestrel", "Bluestone", "Ashgrove", "Meridian Row", "Lanternfish", "Oakhollow", "Tidewater", "Ridgeway", "Fernhill", "Cobalt Peak"];
const NOUNS = ["Supplies", "Studio", "Logistics", "Systems", "Catering", "Office Solutions", "Consulting", "Hardware", "Digital", "Workshop"];
const CUSTOMERS = ["Harbourline Dental Group", "Northgate Primary School", "Elmwood Community Trust", "Pinecrest Veterinary Clinic", "Saltmarsh Architects", "Riverside Climbing Centre", "Greyfield Accountants", "Moorland Bakery Co-operative", "Starling Physiotherapy", "Quayside Theatre Company"];
const STREETS = ["Kestrel Road", "Mill Lane", "Orchard Street", "Station Approach", "Linden Avenue", "Foundry Way", "Wharf Street", "Chapel Row"];

export type PrintedLine = { description: string; quantity: string; unitPrice: string; amount: string };

export type GeneratedInvoice = {
  id: string;
  kind: InvoiceKind;
  /** Rules the true values fail on purpose (the invoice itself is wrong); empty for every other invoice. */
  expectedRuleFailures: RuleCode[];
  template: TemplateName;
  profile: string;
  paper: "A4" | "Letter";
  truth: InvoiceData;
  printed: {
    supplier: { name: string; address: string[]; taxId: string; taxIdLabel: string; email: string };
    customer: { name: string; address: string[] };
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string | null;
    terms: string | null;
    lines: PrintedLine[];
    subtotal: string;
    taxes: Array<{ label: string; amount: string }>;
    total: string;
    currencyNote: string | null;
    /** Handwritten annotations (only on `handwritten` invoices); none of them changes a true value. */
    notes: string[];
  };
};

const iso = (x: Date) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;

/** A price with the currency's minor digits, as a decimal string. JPY rounds to tens, INR to whole rupees. */
function price(r: Random, [min, max]: [number, number], currency: string): string {
  const scale = PRICE_SCALE[currency] ?? 1;
  const raw = (min + r.next() * (max - min)) * scale;
  const digits = minorDigits(currency);
  if (currency === "JPY") return String(Math.max(10, Math.round(raw / 10) * 10));
  if (currency === "INR") return `${Math.max(1, Math.round(raw))}.00`;
  const step = r.chance(0.5) ? 1 : 0.05; // whole units or a price ending in .x5/.x0
  return (Math.max(step, Math.round(raw / step) * step)).toFixed(digits);
}

function quantity(r: Random, kind: Category["quantity"]): string {
  if (kind === "hours") return String(r.pick([0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 7.5, 8, 10, 12, 16, 20, 24, 37.5]));
  if (kind === "people") return String(r.int(6, 80));
  return String(r.pick([1, 1, 1, 2, 2, 3, 4, 5, 6, 10, 12, 20, 25, 40]));
}

/** The n-th test invoice (1-based). Same n, same invoice. */
export function generateInvoice(n: number): GeneratedInvoice {
  const id = `inv-${pad(n, 3)}`;
  const r = seeded(`docwise-testset-v1/${id}`);
  const template = TEMPLATES[(n - 1) % TEMPLATES.length];
  const profileKey = template === "studio" ? STUDIO_PROFILES[Math.floor((n - 1) / TEMPLATES.length) % STUDIO_PROFILES.length] : TEMPLATE_PROFILE[template];
  const profile = PROFILES[profileKey];
  const { currency } = profile;
  const digits = minorDigits(currency);

  // Dates between 5 Jan and 15 Oct 2026.
  const invoiceDate = new Date(Date.UTC(2026, 0, 5) + r.int(0, 283) * 86_400_000);
  const termDays = r.pick([14, 30, 30, 45]);
  const dueMode = r.pick(["date", "date", "date", "date", "terms", "none"] as const);
  const dueDate = dueMode === "date" ? new Date(invoiceDate.getTime() + termDays * 86_400_000) : null;
  const formatDate = r.pick(profile.dates);

  // Line items from one or two categories (three for a long invoice), sometimes with a lump sum at the end.
  const kind = invoiceKind(n);
  const mismatch = MISMATCH[n] ?? null;
  const categories = r.sample(Object.keys(CATALOG), kind === "multipage" ? 3 : r.chance(0.6) ? 1 : 2).map((k) => CATALOG[k]);
  const count = kind === "multipage" ? r.int(30, 40) : mismatch ? r.int(4, 8) : r.pick([1, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 10, 12, 15]);
  const lines: LineItem[] = [];
  const used = new Set<string>();
  while (lines.length < count) {
    const lumpSum = lines.length === count - 1 && count > 1 && r.chance(0.25);
    if (lumpSum) {
      const description = r.pick(LUMP_SUMS);
      lines.push({ description, quantity: null, unit_price: null, amount: price(r, [15, 180], currency) });
      continue;
    }
    const category = r.pick(categories);
    let description = r.pick(category.items);
    if (used.has(description)) description = `${description} (${r.pick(["additional", "replacement", "second batch", "extra"])})`;
    if (used.has(description)) continue;
    used.add(description);
    const qty = quantity(r, category.quantity);
    const unit = price(r, category.price, currency);
    const amount = formatMicros(multiplyMicros(toMicros(qty)!, toMicros(unit)!), digits);
    lines.push({ description, quantity: qty, unit_price: unit, amount });
  }

  if (mismatch?.error === "line") {
    const line = lines[0];
    line.amount = formatMicros(multiplyMicros(toMicros(line.quantity!)! + 1_000_000n, toMicros(line.unit_price!)!), digits);
  }
  const lineSum = lines.reduce((sum, l) => sum + toMicros(l.amount)!, 0n);
  const subtotal = mismatch?.error === "sum" ? lineSum - toMicros(lines.at(-1)!.amount)! : lineSum;
  const taxLines = r.pick(profile.taxes).map((t) => {
    const amount = Math.round((Number(formatMicros(subtotal, digits)) * t.rate) * 10 ** digits) / 10 ** digits;
    return { label: t.label, amount: amount.toFixed(digits) };
  });
  const tax = taxLines.reduce((sum, t) => sum + toMicros(t.amount)!, 0n);
  const total = mismatch?.error === "total" ? transposeDigits(subtotal + tax, digits) : subtotal + tax;

  // In the EU profile, the legal form and VAT prefix follow the supplier's country.
  const supplierCity = r.pick(profile.cities);
  const euCountry = /Berlin|München/.test(supplierCity) ? { suffix: "GmbH", vat: "DE" } : /Amsterdam|Rotterdam/.test(supplierCity) ? { suffix: "B.V.", vat: "NL" } : { suffix: "SARL", vat: "FR" };
  const supplierName = `${r.pick(PREFIXES)} ${r.pick(NOUNS)} ${profile.key === "eu" ? euCountry.suffix : r.pick(profile.suffixes)}`;
  const truth: InvoiceData = {
    supplier_name: supplierName,
    invoice_number: r.pick(profile.numbers)(r, invoiceDate.getUTCFullYear()),
    invoice_date: iso(invoiceDate),
    due_date: dueDate ? iso(dueDate) : null,
    currency,
    subtotal: formatMicros(subtotal, digits),
    tax: taxLines.length ? formatMicros(tax, digits) : null,
    total: formatMicros(total, digits),
    line_items: lines,
  };

  const qtyText = (q: string | null) => (q === null ? "" : q);
  const domain = supplierName.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "") + ".example";
  return {
    id,
    kind,
    expectedRuleFailures: mismatch ? [mismatch.rule] : [],
    template,
    profile: profileKey,
    paper: profile.paper,
    truth,
    printed: {
      supplier: {
        name: supplierName,
        address: [`${r.int(2, 240)} ${r.pick(STREETS)}`, supplierCity],
        taxId: profile.key === "eu" ? profile.taxId(r).replace(/^DE/, euCountry.vat) : profile.taxId(r),
        taxIdLabel: profile.taxIdLabel,
        email: `accounts@${domain}`,
      },
      customer: { name: r.pick(CUSTOMERS), address: [`${r.int(2, 240)} ${r.pick(STREETS)}`, r.pick(profile.cities)] },
      invoiceNumber: truth.invoice_number!,
      invoiceDate: formatDate(invoiceDate),
      dueDate: dueDate ? formatDate(dueDate) : null,
      terms: dueMode === "terms" ? `Payment terms: net ${termDays} days` : null,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: qtyText(l.quantity),
        unitPrice: l.unit_price === null ? "" : profile.money(l.unit_price),
        amount: profile.money(l.amount),
      })),
      subtotal: profile.money(truth.subtotal!),
      taxes: taxLines.map((t) => ({ label: t.label, amount: profile.money(t.amount) })),
      total: profile.money(truth.total!),
      currencyNote: profile.currencyNote ?? null,
      notes: kind === "handwritten" ? handwrittenNotes(seeded(`docwise-testset-v1/${id}/notes`), profile, invoiceDate) : [],
    },
  };
}

/** A typo a person makes copying a total: two adjacent digits of the whole part swapped (1,284.40 → 1,248.40). */
function transposeDigits(micros: bigint, digits: number): bigint {
  const [whole, fraction] = formatMicros(micros, digits).split(".");
  for (let i = whole.length - 1; i > 0; i--) {
    if (whole[i] !== whole[i - 1]) {
      const swapped = whole.slice(0, i - 1) + whole[i] + whole[i - 1] + whole.slice(i + 1);
      return toMicros(fraction ? `${swapped}.${fraction}` : swapped)!;
    }
  }
  return micros + 10n * 1_000_000n;
}

/** Notes an accounts clerk scribbles on a printout. Several carry numbers, dates or amounts that are not the invoice's. */
function handwrittenNotes(r: Random, profile: Profile, invoiceDate: Date): string[] {
  const later = new Date(invoiceDate.getTime() + r.int(5, 20) * 86_400_000);
  const initials = r.pick(["JM", "AK", "R.T.", "SB", "LP"]);
  return [
    r.pick([`Approved for payment – ${initials}`, `OK to pay ${initials}`, `checked ✓ ${initials}`]),
    r.pick([`PO ${r.int(40000, 89999)}`, `GL ${r.int(5000, 6999)} / PO ${r.int(40000, 89999)}`, `cost centre ${r.int(100, 480)}`]),
    r.pick([`paid ${pad(later.getUTCDate())}/${pad(later.getUTCMonth() + 1)} by transfer`, `query: credit of ${profile.money(String(r.int(2, 9) * 10))}?`, `chase delivery note, call ${r.int(100, 999)} ${r.int(1000, 9999)}`]),
  ];
}
