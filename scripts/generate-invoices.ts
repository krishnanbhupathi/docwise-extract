/**
 * Renders the synthetic test set: test-set/invoices/<id>.pdf (or .jpg for
 * phone photos), the true values in test-set/truth/<id>.json, and
 * test-set/manifest.json.
 *
 *   npm run generate:invoices -- --from 1 --to 60
 *
 * Deterministic: an invoice's values depend only on its number. The split is
 * fixed by number too: every third invoice (3, 6, 9, …) is held out.
 * Scans and handwritten invoices are image-only PDFs; photos are JPEGs.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { PAPER_PT, PAPER_PX, notesHtml, photoHtml, photoLook, scanHtml, scanLook } from "../src/testset/looks";
import type { ManifestEntry } from "../src/testset/manifest";
import { generateInvoice, type GeneratedInvoice } from "../src/testset/spec";
import { renderInvoiceHtml } from "../src/testset/templates";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const from = arg("from", 1);
const to = arg("to", 60);

const ROOT = path.join(process.cwd(), "test-set");
mkdirSync(path.join(ROOT, "invoices"), { recursive: true });
mkdirSync(path.join(ROOT, "truth"), { recursive: true });

const FONTS: Array<[family: string, pkg: string, weights: number[]]> = [
  ["Inter", "inter", [400, 600, 700]],
  ["Source Serif 4", "source-serif-4", [400, 600, 700]],
  ["JetBrains Mono", "jetbrains-mono", [400, 600, 700]],
  ["IBM Plex Sans", "ibm-plex-sans", [400, 600, 700]],
  ["Caveat", "caveat", [500]],
];
const fontCss = FONTS.flatMap(([family, pkg, weights]) =>
  weights.map((w) => {
    const file = path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", `${pkg}-latin-${w}-normal.woff2`);
    return `@font-face{font-family:"${family}";font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2");}`;
  }),
).join("\n");

/** The clean page as a PNG at 2× (about 190 dpi), with handwritten notes drawn on when the invoice has them. */
async function pageImage(browser: Browser, inv: GeneratedInvoice): Promise<string> {
  const size = PAPER_PX[inv.paper];
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  await page.setContent(renderInvoiceHtml(inv, fontCss), { waitUntil: "load" });
  // A string, not a function: tsx's transpiled helpers don't exist in the page.
  const bottom = Number(await page.evaluate("Math.ceil(Math.max(...[...document.body.children].map((e) => e.getBoundingClientRect().bottom)))"));
  if (bottom > size.height) throw new Error(`${inv.id} doesn't fit on one page (${bottom}px of ${size.height}px)`);
  if (inv.printed.notes.length) {
    if (bottom + 150 > size.height) throw new Error(`${inv.id} has no room below the content for handwritten notes`);
    await page.evaluate(`document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(notesHtml(inv.id, inv.printed.notes, bottom + 24, size.width))})`);
  }
  await page.evaluate("document.fonts.ready");
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function screenshotJpeg(browser: Browser, html: string, viewport: { width: number; height: number }, quality: number) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  const jpeg = await page.screenshot({ type: "jpeg", quality });
  await page.close();
  return jpeg;
}

/** An image-only PDF, one page at the invoice's paper size: what a scanner produces. */
async function imagePdf(jpeg: Buffer, paper: GeneratedInvoice["paper"]) {
  const pdf = await PDFDocument.create();
  const { width, height } = PAPER_PT[paper];
  const page = pdf.addPage([width, height]);
  page.drawImage(await pdf.embedJpg(jpeg), { x: 0, y: 0, width, height });
  return Buffer.from(await pdf.save());
}

async function render(browser: Browser, inv: GeneratedInvoice): Promise<{ data: Buffer; ext: "pdf" | "jpg"; textLayer: boolean }> {
  if (inv.kind === "scan" || inv.kind === "handwritten") {
    const look = scanLook(inv.id, { light: inv.kind === "handwritten" });
    const jpeg = await screenshotJpeg(browser, scanHtml(await pageImage(browser, inv), look), PAPER_PX[inv.paper], 72);
    return { data: await imagePdf(jpeg, inv.paper), ext: "pdf", textLayer: false };
  }
  if (inv.kind === "photo") {
    const jpeg = await screenshotJpeg(browser, photoHtml(await pageImage(browser, inv), photoLook(inv.id)), { width: 900, height: 1200 }, 82);
    return { data: jpeg, ext: "jpg", textLayer: false };
  }
  const page = await browser.newPage();
  await page.setContent(renderInvoiceHtml(inv, fontCss), { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");
  // Long invoices carry a running footer, as accounting systems print them.
  const footer = `<div style="font:8px sans-serif;color:#555;width:100%;text-align:center">${inv.truth.invoice_number} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
  const pdf = await page.pdf({
    format: inv.paper,
    printBackground: true,
    ...(inv.kind === "multipage"
      ? { displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "28px", bottom: "40px", left: "0", right: "0" } }
      : { margin: { top: "0", bottom: "0", left: "0", right: "0" } }),
  });
  await page.close();
  return { data: pdf, ext: "pdf", textLayer: true };
}

async function main() {
  const manifestPath = path.join(ROOT, "manifest.json");
  const manifest: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];

  const browser = await chromium.launch();
  for (let n = from; n <= to; n++) {
    const inv = generateInvoice(n);
    const { data, ext, textLayer } = await render(browser, inv);
    const file = `invoices/${inv.id}.${ext}`;
    writeFileSync(path.join(ROOT, file), data);
    writeFileSync(path.join(ROOT, "truth", `${inv.id}.json`), JSON.stringify(inv.truth, null, 2) + "\n");
    const pages = ext === "pdf" ? (await PDFDocument.load(data)).getPageCount() : 1;
    const entry: ManifestEntry = {
      id: inv.id,
      file,
      truth: `truth/${inv.id}.json`,
      split: n % 3 === 0 ? "held_out" : "tuning",
      slice: inv.kind === "clean" ? "clean" : "hard",
      kind: inv.kind,
      mediaType: ext === "pdf" ? "application/pdf" : "image/jpeg",
      textLayer,
      expectedRuleFailures: inv.expectedRuleFailures,
      template: inv.template,
      profile: inv.profile,
      currency: inv.truth.currency!,
      lineItems: inv.truth.line_items.length,
      pages,
    };
    const existing = manifest.findIndex((m) => m.id === inv.id);
    if (existing >= 0) manifest[existing] = entry;
    else manifest.push(entry);
    console.log(`${inv.id}  ${inv.kind.padEnd(11)} ${inv.template.padEnd(8)} ${entry.currency}  ${String(entry.lineItems).padStart(2)} lines  ${pages} page${pages > 1 ? "s" : ""}  ${(data.byteLength / 1024).toFixed(0)} KB  ${entry.split}`);
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
