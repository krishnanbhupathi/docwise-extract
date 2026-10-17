/**
 * Renders the synthetic test set: test-set/invoices/<id>.pdf, the true values
 * in test-set/truth/<id>.json, and test-set/manifest.json.
 *
 *   npm run generate:invoices -- --from 1 --to 20
 *
 * Deterministic: an invoice's values depend only on its number. The split is
 * fixed by number too: every third invoice (3, 6, 9, …) is held out.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { generateInvoice } from "../src/testset/spec";
import type { ManifestEntry } from "../src/testset/manifest";
import { renderInvoiceHtml } from "../src/testset/templates";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const from = arg("from", 1);
const to = arg("to", 20);

const ROOT = path.join(process.cwd(), "test-set");
mkdirSync(path.join(ROOT, "invoices"), { recursive: true });
mkdirSync(path.join(ROOT, "truth"), { recursive: true });

const FONTS: Array<[family: string, pkg: string, weights: number[]]> = [
  ["Inter", "inter", [400, 600, 700]],
  ["Source Serif 4", "source-serif-4", [400, 600, 700]],
  ["JetBrains Mono", "jetbrains-mono", [400, 600, 700]],
  ["IBM Plex Sans", "ibm-plex-sans", [400, 600, 700]],
];
const fontCss = FONTS.flatMap(([family, pkg, weights]) =>
  weights.map((w) => {
    const file = path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", `${pkg}-latin-${w}-normal.woff2`);
    return `@font-face{font-family:"${family}";font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2");}`;
  }),
).join("\n");

async function main() {
  const manifestPath = path.join(ROOT, "manifest.json");
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (let n = from; n <= to; n++) {
    const inv = generateInvoice(n);
    await page.setContent(renderInvoiceHtml(inv, fontCss), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: inv.paper, printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    const file = `invoices/${inv.id}.pdf`;
    writeFileSync(path.join(ROOT, file), pdf);
    writeFileSync(path.join(ROOT, "truth", `${inv.id}.json`), JSON.stringify(inv.truth, null, 2) + "\n");
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    const entry: ManifestEntry = {
      id: inv.id,
      file,
      truth: `truth/${inv.id}.json`,
      split: n % 3 === 0 ? "held_out" : "tuning",
      slice: "clean",
      template: inv.template,
      profile: inv.profile,
      currency: inv.truth.currency!,
      lineItems: inv.truth.line_items.length,
      pages,
    };
    const existing = manifest.findIndex((m) => m.id === inv.id);
    if (existing >= 0) manifest[existing] = entry;
    else manifest.push(entry);
    console.log(`${inv.id}  ${inv.template.padEnd(8)} ${entry.currency}  ${String(entry.lineItems).padStart(2)} lines  ${pages} page${pages > 1 ? "s" : ""}  ${entry.split}`);
  }
  await browser.close();
  manifest.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${manifest.length} invoices`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
