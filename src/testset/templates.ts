import type { GeneratedInvoice, TemplateName } from "./spec";

/**
 * Five invoice layouts that differ the way real ones do: where the number and
 * dates sit, what the totals are called ("Net amount", "Amount due", "Total
 * Invoice Value"), extra columns (HSN/SAC codes), and typefaces. Fonts are
 * embedded by the generator, so rendering needs no network.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (items: string[]) => items.map(esc).join("<br>");

type Render = (inv: GeneratedInvoice) => string;

const classic: Render = ({ printed: p }) => `
<style>
  body { font-family: "Source Serif 4", serif; color: #222; margin: 0; padding: 48px 56px; font-size: 12.5px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 38px; letter-spacing: 3px; margin: 0; font-weight: 600; color: #333; }
  .supplier strong { font-size: 18px; }
  .meta { margin-top: 28px; display: flex; justify-content: space-between; }
  .meta table td { padding: 2px 0 2px 16px; }
  .meta table td:first-child { color: #666; padding-left: 0; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 32px; }
  table.items th { text-align: left; border-bottom: 2px solid #333; padding: 6px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  table.items td { border-bottom: 1px solid #ddd; padding: 7px 4px; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; margin-top: 16px; width: 280px; }
  .totals td { padding: 4px; }
  .totals tr.grand td { border-top: 2px solid #333; font-weight: 700; font-size: 15px; }
  .foot { margin-top: 40px; color: #666; font-size: 11px; }
</style>
<div class="top">
  <div class="supplier"><strong>${esc(p.supplier.name)}</strong><br>${lines(p.supplier.address)}<br>${esc(p.supplier.email)}<br>${esc(p.supplier.taxIdLabel)}: ${esc(p.supplier.taxId)}</div>
  <h1>INVOICE</h1>
</div>
<div class="meta">
  <div><div style="color:#666;text-transform:uppercase;font-size:11px;letter-spacing:1px">Bill to</div><strong>${esc(p.customer.name)}</strong><br>${lines(p.customer.address)}</div>
  <table>
    <tr><td>Invoice #</td><td>${esc(p.invoiceNumber)}</td></tr>
    <tr><td>Invoice date</td><td>${esc(p.invoiceDate)}</td></tr>
    ${p.dueDate ? `<tr><td>Due date</td><td>${esc(p.dueDate)}</td></tr>` : ""}
  </table>
</div>
<table class="items">
  <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
  <tbody>${p.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(l.unitPrice)}</td><td class="num">${esc(l.amount)}</td></tr>`).join("")}</tbody>
</table>
<table class="totals">
  <tr><td>Subtotal</td><td class="num">${esc(p.subtotal)}</td></tr>
  ${p.taxes.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${esc(t.amount)}</td></tr>`).join("")}
  <tr class="grand"><td>Total due</td><td class="num">${esc(p.total)}</td></tr>
</table>
<div class="foot">${p.terms ? `${esc(p.terms)}. ` : ""}Thank you for your business.</div>`;

const modern: Render = ({ printed: p }) => `
<style>
  body { font-family: "Inter", sans-serif; color: #1d2433; margin: 0; font-size: 11.5px; }
  .band { background: #1f4f8f; color: #fff; padding: 28px 48px; display: flex; justify-content: space-between; align-items: flex-end; }
  .band h1 { margin: 0; font-size: 26px; font-weight: 700; }
  .band .no { font-size: 13px; opacity: .9; }
  .wrap { padding: 28px 48px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
  .label { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #6b7590; margin-bottom: 4px; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 28px; }
  table.items th { background: #eef2f8; text-align: left; padding: 8px 6px; font-weight: 600; font-size: 10.5px; }
  table.items td { padding: 8px 6px; border-bottom: 1px solid #e4e8ef; }
  .num { text-align: right; white-space: nowrap; }
  .sum { display: flex; justify-content: flex-end; margin-top: 18px; }
  .sum table td { padding: 4px 8px; }
  .sum .gross td { background: #1f4f8f; color: #fff; font-weight: 700; font-size: 13px; }
  .bank { margin-top: 36px; color: #6b7590; font-size: 10px; border-top: 1px solid #e4e8ef; padding-top: 10px; }
</style>
<div class="band"><div><h1>${esc(p.supplier.name)}</h1><div>${lines(p.supplier.address)}</div></div><div class="no">Invoice no. ${esc(p.invoiceNumber)}</div></div>
<div class="wrap">
  <div class="cols">
    <div><div class="label">Customer</div><strong>${esc(p.customer.name)}</strong><br>${lines(p.customer.address)}</div>
    <div><div class="label">Invoice date</div>${esc(p.invoiceDate)}${p.dueDate ? `<div class="label" style="margin-top:10px">Payable by</div>${esc(p.dueDate)}` : ""}</div>
    <div><div class="label">${esc(p.supplier.taxIdLabel)}</div>${esc(p.supplier.taxId)}<div class="label" style="margin-top:10px">Contact</div>${esc(p.supplier.email)}</div>
  </div>
  <table class="items">
    <thead><tr><th>Pos.</th><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
    <tbody>${p.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(l.unitPrice)}</td><td class="num">${esc(l.amount)}</td></tr>`).join("")}</tbody>
  </table>
  <div class="sum"><table>
    <tr><td>Net amount</td><td class="num">${esc(p.subtotal)}</td></tr>
    ${p.taxes.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${esc(t.amount)}</td></tr>`).join("")}
    <tr class="gross"><td>Gross amount</td><td class="num">${esc(p.total)}</td></tr>
  </table></div>
  <div class="bank">${p.terms ? `${esc(p.terms)}. ` : ""}Please quote the invoice number with your payment.</div>
</div>`;

const minimal: Render = ({ printed: p }) => `
<style>
  body { font-family: "JetBrains Mono", monospace; color: #111; margin: 0; padding: 52px 56px; font-size: 11px; line-height: 1.5; }
  h1 { font-size: 15px; margin: 0 0 24px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
  .k { color: #777; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; border-bottom: 1px solid #111; padding: 4px 2px; }
  td { padding: 4px 2px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 10px; border-top: 1px dashed #999; }
  .totals td { padding-top: 6px; }
  .due td { font-weight: 700; border-top: 1px solid #111; }
</style>
<h1>${esc(p.supplier.name)} — Invoice</h1>
<div class="grid">
  <div><span class="k">From</span><br>${esc(p.supplier.name)}<br>${lines(p.supplier.address)}<br><span class="k">${esc(p.supplier.taxIdLabel)}</span> ${esc(p.supplier.taxId)}</div>
  <div><span class="k">To</span><br>${esc(p.customer.name)}<br>${lines(p.customer.address)}</div>
  <div><span class="k">Invoice number</span> ${esc(p.invoiceNumber)}<br><span class="k">Invoice date</span> ${esc(p.invoiceDate)}${p.dueDate ? `<br><span class="k">Payment due</span> ${esc(p.dueDate)}` : ""}</div>
</div>
<table>
  <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line total</th></tr></thead>
  <tbody>${p.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(l.unitPrice)}</td><td class="num">${esc(l.amount)}</td></tr>`).join("")}</tbody>
</table>
<table class="totals">
  <tr><td></td><td class="num" style="width:160px">Subtotal</td><td class="num" style="width:130px">${esc(p.subtotal)}</td></tr>
  ${p.taxes.map((t) => `<tr><td></td><td class="num">${esc(t.label)}</td><td class="num">${esc(t.amount)}</td></tr>`).join("")}
  <tr class="due"><td></td><td class="num">Amount due</td><td class="num">${esc(p.total)}</td></tr>
</table>
<p class="k" style="margin-top:28px">${p.terms ? `${esc(p.terms)}. ` : ""}Bank transfer to the account on file. ${esc(p.supplier.email)}</p>`;

const gst: Render = ({ printed: p, id }) => {
  // HSN/SAC codes: an extra column real Indian invoices carry, which must not end up in the extraction.
  const hsn = (i: number) => String(998300 + ((id.charCodeAt(5) * 7 + i * 13) % 99));
  return `
<style>
  body { font-family: "IBM Plex Sans", sans-serif; color: #000; margin: 0; padding: 32px 36px; font-size: 10.5px; }
  .box { border: 1px solid #000; }
  .title { text-align: center; font-weight: 700; font-size: 14px; padding: 6px; border-bottom: 1px solid #000; letter-spacing: 2px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #000; }
  .row > div { padding: 6px 8px; }
  .row > div + div { border-left: 1px solid #000; }
  .label { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 6px; }
  th { background: #f0f0f0; font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  .sign { text-align: right; padding: 18px 8px 8px; }
</style>
<div class="box">
  <div class="title">TAX INVOICE</div>
  <div class="row">
    <div><strong style="font-size:13px">${esc(p.supplier.name)}</strong><br>${lines(p.supplier.address)}<br><span class="label">${esc(p.supplier.taxIdLabel)}:</span> ${esc(p.supplier.taxId)}<br>${esc(p.supplier.email)}</div>
    <div><span class="label">Invoice No.:</span> ${esc(p.invoiceNumber)}<br><span class="label">Invoice Date:</span> ${esc(p.invoiceDate)}${p.dueDate ? `<br><span class="label">Due Date:</span> ${esc(p.dueDate)}` : ""}<br><span class="label">Place of Supply:</span> ${esc(p.customer.address[1].split(",")[1]?.replace(/\s*\d+$/, "").trim() ?? "")}</div>
  </div>
  <div class="row"><div><span class="label">Billed To:</span><br>${esc(p.customer.name)}<br>${lines(p.customer.address)}</div><div><span class="label">Ship To:</span><br>Same as billing address</div></div>
  <table>
    <thead><tr><th>S.No.</th><th>Description of Goods / Services</th><th>HSN/SAC</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Taxable Value</th></tr></thead>
    <tbody>${p.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${hsn(i)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(l.unitPrice)}</td><td class="num">${esc(l.amount)}</td></tr>`).join("")}</tbody>
    <tfoot>
      <tr><td colspan="5" class="num"><strong>Total Taxable Value</strong></td><td class="num">${esc(p.subtotal)}</td></tr>
      ${p.taxes.map((t) => `<tr><td colspan="5" class="num">${esc(t.label)}</td><td class="num">${esc(t.amount)}</td></tr>`).join("")}
      <tr><td colspan="5" class="num"><strong>Total Invoice Value</strong></td><td class="num"><strong>${esc(p.total)}</strong></td></tr>
    </tfoot>
  </table>
  <div class="sign">${p.terms ? `<div style="text-align:left">${esc(p.terms)}</div>` : ""}For ${esc(p.supplier.name)}<br><br><br>Authorised Signatory</div>
</div>`;
};

const studio: Render = ({ printed: p }) => `
<style>
  body { font-family: "Inter", sans-serif; color: #2b2b2b; margin: 0; padding: 56px 60px; font-size: 11.5px; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #c2410c; padding-bottom: 18px; }
  .brand { font-family: "Source Serif 4", serif; font-size: 24px; font-weight: 700; color: #c2410c; }
  .facts { text-align: right; }
  .facts b { display: inline-block; min-width: 90px; color: #888; font-weight: 600; }
  .parties { display: flex; gap: 60px; margin: 26px 0; }
  .parties small { display: block; color: #888; text-transform: uppercase; letter-spacing: .1em; font-size: 9px; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #888; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; padding: 6px 4px; border-bottom: 1px solid #ccc; }
  td { padding: 9px 4px; border-bottom: 1px solid #eee; }
  .num { text-align: right; white-space: nowrap; }
  .tot { width: 300px; margin: 18px 0 0 auto; }
  .tot td { border: 0; padding: 4px; }
  .tot .due td { font-size: 16px; font-weight: 700; color: #c2410c; border-top: 2px solid #c2410c; padding-top: 8px; }
  .note { margin-top: 34px; color: #777; }
</style>
<div class="head">
  <div><div class="brand">${esc(p.supplier.name)}</div>${lines(p.supplier.address)}<br>${esc(p.supplier.taxIdLabel)} ${esc(p.supplier.taxId)}</div>
  <div class="facts"><div style="font-size:18px;font-weight:700;margin-bottom:6px">Tax invoice</div><b>Number</b> ${esc(p.invoiceNumber)}<br><b>Issued</b> ${esc(p.invoiceDate)}${p.dueDate ? `<br><b>Due</b> ${esc(p.dueDate)}` : ""}</div>
</div>
<div class="parties">
  <div><small>Billed to</small><strong>${esc(p.customer.name)}</strong><br>${lines(p.customer.address)}</div>
  <div><small>Questions</small>${esc(p.supplier.email)}</div>
</div>
<table>
  <thead><tr><th>Description</th><th class="num">Hrs / Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
  <tbody>${p.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(l.unitPrice)}</td><td class="num">${esc(l.amount)}</td></tr>`).join("")}</tbody>
</table>
<table class="tot">
  <tr><td>Subtotal</td><td class="num">${esc(p.subtotal)}</td></tr>
  ${p.taxes.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${esc(t.amount)}</td></tr>`).join("")}
  <tr class="due"><td>Amount due</td><td class="num">${esc(p.total)}</td></tr>
</table>
<div class="note">${p.currencyNote ? `${esc(p.currencyNote)} ` : ""}${p.terms ? `${esc(p.terms)}.` : ""}</div>`;

const RENDERERS: Record<TemplateName, Render> = { classic, modern, minimal, gst, studio };

/** The full HTML document for an invoice; `fontCss` holds the embedded @font-face rules. */
export function renderInvoiceHtml(inv: GeneratedInvoice, fontCss: string): string {
  // Rows never split across pages on long invoices; table headers repeat on each page by default.
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss} tr{break-inside:avoid}</style></head><body>${RENDERERS[inv.template](inv)}</body></html>`;
}
