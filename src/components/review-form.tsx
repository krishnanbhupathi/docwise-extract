"use client";

import { useState, useTransition } from "react";
import { approveReview } from "@/app/actions";
import { REASON_LABELS, type ConfidenceReason } from "@/lib/confidence";
import { FIELD_LABELS, HEADER_FIELDS, type FieldName, type HeaderField, type InvoiceData } from "@/lib/invoice";
import { blockingProblems, normalizeReview } from "@/lib/review";
import { checkInvoice } from "@/lib/rules";

/** What the extraction said about each field: why it was low (besides the rules, which re-run live) and the model's note. */
export type FieldFlags = Partial<Record<FieldName, { reasons: ConfidenceReason[]; note: string | null }>>;

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

/**
 * The review form: every extracted value is editable, line items can be
 * fixed, added and removed, and the rule checks re-run as you type. Approving
 * with checks still failing (an invoice that is itself wrong) needs a tick.
 */
export function ReviewForm({ documentId, initial, extracted, flags }: { documentId: string; initial: InvoiceData; extracted: InvoiceData; flags: FieldFlags }) {
  const [header, setHeader] = useState<Record<HeaderField, string>>(
    () => Object.fromEntries(HEADER_FIELDS.map((name) => [name, initial[name] ?? ""])) as Record<HeaderField, string>,
  );
  const [lines, setLines] = useState<Line[]>(() => toLines(initial));
  const [nextKey, setNextKey] = useState(initial.line_items.length);
  const [accept, setAccept] = useState(false);
  const [result, setResult] = useState<{ error: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const data = normalizeReview({ ...header, line_items: lines.map(({ description, quantity, unit_price, amount }) => ({ description, quantity, unit_price, amount })) });
  const { failures, byField } = checkInvoice(data);
  const problems = blockingProblems(data, failures);
  const canApprove = !pending && problems.length === 0 && (failures.length === 0 || accept);

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
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canApprove) approve();
      }}
    >
      <fieldset className="grid min-w-0 gap-4 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2">
        <legend className="sr-only">Invoice fields</legend>
        {HEADER_FIELDS.map((name) => {
          const flag = flags[name];
          const failing = byField[name].length > 0;
          const changed = (data[name] ?? null) !== extracted[name];
          return (
            <div key={name} className={`flex min-w-0 flex-col gap-1 ${name === "supplier_name" ? "sm:col-span-2" : ""}`}>
              <label htmlFor={`f-${name}`} className="text-sm font-medium text-muted">
                {FIELD_LABELS[name]}
              </label>
              <input
                id={`f-${name}`}
                value={header[name]}
                placeholder={PLACEHOLDERS[name] ?? "not on the invoice"}
                onChange={(e) => edit(() => setHeader((h) => ({ ...h, [name]: e.target.value })))}
                aria-invalid={failing || undefined}
                aria-describedby={flag || changed ? `h-${name}` : undefined}
                className={`rounded-lg border bg-paper px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
                  failing ? "border-flag" : flag ? "border-flag/50" : "border-line"
                }`}
              />
              {(flag || changed) && (
                <p id={`h-${name}`} className="text-xs text-muted">
                  {flag && <span className="text-flag">{describeFlag(flag)}</span>}
                  {flag && changed && " · "}
                  {changed && <>extracted: {extracted[name] === null ? <em>empty</em> : <span className="font-mono">{extracted[name]}</span>}</>}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <legend className="text-sm font-semibold tracking-wide text-muted uppercase">Line items ({lines.length})</legend>
          {flags.line_items && <p className="text-xs text-flag">{describeFlag(flags.line_items)}</p>}
        </div>
        {/* `relative` keeps the absolutely positioned sr-only header inside the scroll box (else it widens the page on phones). */}
        <div className={`relative overflow-x-auto rounded-xl border bg-panel ${byField.line_items.length ? "border-flag" : "border-line"}`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="w-8 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Unit price</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-10 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((line, i) => (
                <tr key={line.key}>
                  <td className="px-3 py-1.5 text-muted">{i + 1}</td>
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
                        className={`${cellInput} text-right font-mono`}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => edit(() => setLines((all) => all.filter((l) => l.key !== line.key)))}
                      aria-label={`Remove line ${i + 1}`}
                      className="rounded-md px-2 py-1 text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              edit(() => {
                setLines((all) => [...all, { key: nextKey, description: "", quantity: "", unit_price: "", amount: "" }]);
                setNextKey((k) => k + 1);
              })
            }
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-accent/60"
          >
            Add a line
          </button>
          <button
            type="button"
            onClick={() =>
              edit(() => {
                setLines(toLines(extracted, nextKey));
                setNextKey((k) => k + extracted.line_items.length);
              })
            }
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            Reset lines to extracted
          </button>
        </div>
      </fieldset>

      <section aria-live="polite" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Checks</h2>
        {failures.length === 0 ? (
          <p className="rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">All rule checks pass with these values.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failures.map((f, i) => (
              <li key={i} className="rounded-lg bg-flag-bg px-4 py-2.5 text-sm text-flag">
                <span className="font-semibold">{f.fields.map((name) => FIELD_LABELS[name]).join(", ")}:</span> {f.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
        {failures.length > 0 && problems.length === 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={accept} onChange={(e) => edit(() => setAccept(e.target.checked))} className="mt-0.5 size-4 accent-accent" />
            <span>The values match the invoice; the invoice itself doesn&apos;t add up. Approve it as printed.</span>
          </label>
        )}
        {problems.length > 0 && (
          <div className="text-sm text-danger">
            <p className="font-medium">Fix these before approving:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {result && (
          <div role="alert" className="text-sm text-danger">
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
          <button type="submit" disabled={!canApprove} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? "Approving…" : "Approve invoice"}
          </button>
          <p className="text-xs text-muted">Changed values are stored as corrections; the extracted values are kept.</p>
        </div>
      </div>
    </form>
  );
}

const cellInput = "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-line focus:border-accent focus:bg-paper";

function describeFlag({ reasons, note }: { reasons: ConfidenceReason[]; note: string | null }) {
  return reasons
    .filter((r) => !r.startsWith("rule:"))
    .map((r) => (r === "model_uncertain" && note ? `${REASON_LABELS[r]}: ${note}` : REASON_LABELS[r]))
    .join(" · ");
}
