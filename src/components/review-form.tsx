"use client";

import { useState, useTransition } from "react";
import { approveReview } from "@/app/actions";
import type { ConfidenceReason } from "@/lib/confidence";
import { FIELD_LABELS, FIELD_NAMES, HEADER_FIELDS, type FieldName, type HeaderField, type InvoiceData } from "@/lib/invoice";
import { flagged, footings, marksFor, type Mark } from "@/lib/marks";
import { groupDigits } from "@/lib/money";
import { blockingProblems, normalizeReview } from "@/lib/review";
import { checkInvoice } from "@/lib/rules";
import { FieldRow, Sheet, TotalRow } from "./audit-sheet";
import { MarkChips, MarkLegend } from "./marks";

type Line = { key: number; description: string; quantity: string; unit_price: string; amount: string };

const PLACEHOLDERS: Partial<Record<HeaderField, string>> = {
  invoice_date: "YYYY-MM-DD",
  due_date: "YYYY-MM-DD",
  currency: "EUR",
  subtotal: "1234.50",
  tax: "246.90",
  total: "1481.40",
};

const toLines = (data: InvoiceData, start = 0): Line[] =>
  data.line_items.map((item, i) => ({ key: start + i, description: item.description, quantity: item.quantity ?? "", unit_price: item.unit_price ?? "", amount: item.amount }));

const sameLines = (a: InvoiceData["line_items"], b: InvoiceData["line_items"]) => JSON.stringify(a) === JSON.stringify(b);

const extensionMark = (ok: boolean | null | undefined): Mark[] =>
  ok === null || ok === undefined ? [] : [{ kind: "extended", state: ok ? "pass" : "fail", note: ok ? "quantity × unit price = amount" : "quantity × unit price ≠ amount" }];

/**
 * The review form: the audit sheet with every value editable. Line items can
 * be fixed, added and removed, and the marks re-run as you type (a value you
 * change can no longer be vouched against the document, so its ✓ opens).
 * Approving with checks still failing (an invoice that is itself wrong) needs a tick.
 */
export function ReviewForm({
  documentId,
  initial,
  extracted,
  reasons,
  notes,
  hasText,
}: {
  documentId: string;
  initial: InvoiceData;
  extracted: InvoiceData;
  reasons: Partial<Record<FieldName, ConfidenceReason[]>>;
  notes: Partial<Record<FieldName, string>>;
  hasText: boolean | null;
}) {
  const [header, setHeader] = useState<Record<HeaderField, string>>(
    () => Object.fromEntries(HEADER_FIELDS.map((name) => [name, initial[name] ?? ""])) as Record<HeaderField, string>,
  );
  const [lines, setLines] = useState<Line[]>(() => toLines(initial));
  const [nextKey, setNextKey] = useState(initial.line_items.length);
  const [accept, setAccept] = useState(false);
  const [result, setResult] = useState<{ error: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const data = normalizeReview({ ...header, line_items: lines.map(({ description, quantity, unit_price, amount }) => ({ description, quantity, unit_price, amount })) });
  const rules = checkInvoice(data);
  const problems = blockingProblems(data, rules.failures);
  const edited = new Set<FieldName>([...HEADER_FIELDS.filter((name) => data[name] !== extracted[name]), ...(sameLines(data.line_items, extracted.line_items) ? [] : ["line_items" as const])]);
  const marks = marksFor(data, { rules, reasons, hasText, edited });
  const sums = footings(data);
  const flaggedCount = FIELD_NAMES.filter((name) => flagged(marks[name])).length;
  const canApprove = !pending && problems.length === 0 && (rules.failures.length === 0 || accept);

  const edit = (update: () => void) => {
    update();
    setResult(null);
  };
  const setLine = (key: number, patch: Partial<Line>) => edit(() => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l))));

  function approve() {
    startTransition(async () => {
      const response = await approveReview(documentId, { data, acceptFailingRules: accept });
      if (!response.ok) setResult(response);
    });
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canApprove) approve();
      }}
    >
      <Sheet
        title="Audit sheet · review"
        aside={<span className={`text-xs font-medium ${flaggedCount ? "text-fail" : "text-cobalt"}`}>{flaggedCount ? `${flaggedCount} of ${FIELD_NAMES.length} need a look` : "Every mark passes"}</span>}
      >
        {HEADER_FIELDS.map((name) => {
          const isFlagged = flagged(marks[name]);
          const fieldNotes = [
            ...(edited.has(name) ? [`extracted: ${extracted[name] ?? "empty"}`] : []),
            ...(notes[name] && !edited.has(name) ? [`model: “${notes[name]}”`] : []),
          ];
          return (
            <FieldRow key={name} label={FIELD_LABELS[name]} htmlFor={`f-${name}`} marks={marks[name]} notes={fieldNotes}>
              <input
                id={`f-${name}`}
                value={header[name]}
                placeholder={PLACEHOLDERS[name] ?? "not on the invoice"}
                onChange={(e) => edit(() => setHeader((h) => ({ ...h, [name]: e.target.value })))}
                aria-invalid={isFlagged || undefined}
                className={`w-full rounded-md border px-2.5 py-1.5 outline-none placeholder:text-muted/60 focus:border-cobalt focus:ring-2 focus:ring-cobalt/25 ${
                  name === "supplier_name" ? "font-medium" : "figures"
                } ${isFlagged ? "border-flag/40 bg-flag-tint" : "border-line bg-sheet"}`}
              />
            </FieldRow>
          );
        })}
        <div className="border-t border-line px-4 py-3">
          <MarkLegend />
        </div>
      </Sheet>

      <Sheet title={`Line items (${lines.length})`} aside={<MarkChips marks={marks.line_items} />}>
        {/* `relative` keeps the absolutely positioned sr-only header inside the scroll box (else it widens the page on phones). */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="w-10 px-4 py-2 font-medium">#</th>
                <th className="px-1 py-2 font-medium">Description</th>
                <th className="w-20 px-1 py-2 text-right font-medium">Qty</th>
                <th className="w-28 px-1 py-2 text-right font-medium">Unit price</th>
                <th className="w-28 px-1 py-2 text-right font-medium">Amount</th>
                <th className="w-10 px-1 py-2 text-right font-medium">
                  <span className="sr-only">Extends</span>
                </th>
                <th className="w-10 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.key} className="border-b border-line last:border-0">
                  <td className="figures px-4 py-1.5 text-muted">{i + 1}</td>
                  <td className="px-1 py-1.5">
                    <input aria-label={`Line ${i + 1} description`} value={line.description} onChange={(e) => setLine(line.key, { description: e.target.value })} className={cellInput} />
                  </td>
                  {(["quantity", "unit_price", "amount"] as const).map((column) => (
                    <td key={column} className="px-1 py-1.5">
                      <input
                        aria-label={`Line ${i + 1} ${column.replace("_", " ")}`}
                        value={line[column]}
                        inputMode="decimal"
                        onChange={(e) => setLine(line.key, { [column]: e.target.value })}
                        className={`${cellInput} figures text-right ${column === "amount" && rules.lineExtends[i] === false ? "bg-flag-tint" : ""}`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-right">
                    <MarkChips marks={extensionMark(rules.lineExtends[i])} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => edit(() => setLines((all) => all.filter((l) => l.key !== line.key)))}
                      aria-label={`Remove line ${i + 1}`}
                      className="rounded-md px-1.5 py-1 text-muted hover:bg-fail-tint hover:text-fail"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-line border-t border-line bg-sheet-2">
          {sums.lines !== null && (
            <TotalRow
              kind="footed"
              label="Lines"
              value={groupDigits(sums.lines)}
              against={data.subtotal !== null ? `vs subtotal ${groupDigits(data.subtotal)}` : undefined}
              marks={marks.line_items.filter((m) => m.kind === "footed")}
            />
          )}
          {sums.subtotalPlusTax !== null && data.total !== null && (
            <TotalRow kind="crossfooted" label="Subtotal + tax" value={groupDigits(sums.subtotalPlusTax)} against={`vs total ${groupDigits(data.total)}`} marks={marks.total.filter((m) => m.kind === "crossfooted")} />
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() =>
              edit(() => {
                setLines((all) => [...all, { key: nextKey, description: "", quantity: "", unit_price: "", amount: "" }]);
                setNextKey((k) => k + 1);
              })
            }
            className="rounded-md border border-line bg-sheet px-3 py-1.5 text-sm font-medium hover:border-cobalt/60"
          >
            + Add a line
          </button>
          <button
            type="button"
            onClick={() =>
              edit(() => {
                setLines(toLines(extracted, nextKey));
                setNextKey((k) => k + extracted.line_items.length);
              })
            }
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            Reset lines to extracted
          </button>
        </div>
      </Sheet>

      {/* Sign-off bar: on wider screens it stays in view while the sheet scrolls (on a phone it would cover too much). */}
      <div className="z-10 flex sm:sticky sm:bottom-3 flex-col gap-3 rounded-2xl border border-line bg-sheet/95 p-4 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] backdrop-blur" aria-live="polite">
        {rules.failures.length > 0 && problems.length === 0 && (
          <div className="flex flex-col gap-2 text-sm">
            <ul className="flex flex-col gap-1 text-fail">
              {rules.failures.map((f, i) => (
                <li key={i}>
                  <span className="font-semibold">{f.fields.map((name) => FIELD_LABELS[name]).join(", ")}:</span> {f.message}
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={accept} onChange={(e) => edit(() => setAccept(e.target.checked))} className="mt-0.5 size-4 accent-[var(--cobalt)]" />
              <span>The values match the invoice; the invoice itself doesn&apos;t add up. Approve it as printed.</span>
            </label>
          </div>
        )}
        {problems.length > 0 && (
          <div className="text-sm text-fail">
            <p className="font-medium">Fix these before approving:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {result && (
          <div role="alert" className="text-sm text-fail">
            <p>{result.error}</p>
            {result.problems && (
              <ul className="mt-1 list-disc pl-5">
                {result.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canApprove} className="rounded-md bg-cobalt px-4 py-2 text-sm font-semibold text-cobalt-ink disabled:cursor-not-allowed disabled:opacity-45">
            {pending ? "Approving…" : "✓ Approve invoice"}
          </button>
          <p className="text-xs text-muted">Changed values are kept as corrections beside the extracted ones.</p>
        </div>
      </div>
    </form>
  );
}

const cellInput = "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-line focus:border-cobalt focus:bg-sheet";
