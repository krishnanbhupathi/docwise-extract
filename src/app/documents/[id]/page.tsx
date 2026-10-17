import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FieldRow, Sheet, TotalRow } from "@/components/audit-sheet";
import { AutoRefresh } from "@/components/auto-refresh";
import { MarkChips, MarkLegend } from "@/components/marks";
import { RetryButton } from "@/components/retry-button";
import { TrySampleButton } from "@/components/try-sample-button";
import { ReviewForm } from "@/components/review-form";
import { StatusTag } from "@/components/status";
import { db } from "@/db";
import type { ConfidenceReason } from "@/lib/confidence";
import { FIELD_LABELS, FIELD_NAMES, HEADER_FIELDS, type FieldName, type HeaderField } from "@/lib/invoice";
import { flagged, footings, marksFor, type Mark } from "@/lib/marks";
import { groupDigits } from "@/lib/money";
import { costUsd } from "@/lib/pricing";
import { checkInvoice } from "@/lib/rules";
import { SAMPLE_RUN, sampleFor } from "@/lib/samples";
import { MAX_RUNS, canRetry, currentInvoice, extractedInvoice, getDocument, type DocumentView } from "@/server/documents";
import { getStorage } from "@/server/storage";
import { readWorkspace } from "@/server/workspace";

export const metadata: Metadata = { title: "Invoice · Docwise", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

export default async function DocumentPage({ params }: Props) {
  const { id } = await params;
  const workspaceId = await readWorkspace();
  const view = await getDocument(db, id, workspaceId);
  if (!view) notFound();
  const { doc } = view;
  // Demo documents are visible to everyone but only reviewed by the browser that owns them.
  const own = workspaceId !== null && doc.workspaceId === workspaceId;
  const fileUrl = await getStorage().createDownloadUrl(doc.fileKey);
  const working = doc.status === "queued" || doc.status === "extracting" || doc.status === "uploading";
  const retryable = own && canRetry(doc);
  const stuck = working && retryable;
  const reasons = Object.fromEntries(view.fields.map((f) => [f.name, f.confidenceReasons as ConfidenceReason[]])) as Partial<Record<FieldName, ConfidenceReason[]>>;
  const notes = Object.fromEntries(view.fields.filter((f) => f.modelUncertain).map((f) => [f.name, f.modelUncertain!])) as Partial<Record<FieldName, string>>;

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-2 lg:py-8">
      {working && !stuck && <AutoRefresh />}

      <section aria-label="Original document" className="bench rounded-2xl p-3 sm:p-5 lg:sticky lg:top-4 lg:self-start">
        <div className="overflow-hidden rounded-md bg-white shadow-[0_24px_48px_-20px_rgb(0_0_0/0.7)]">
          {doc.mediaType === "application/pdf" ? (
            <iframe src={`${fileUrl}#navpanes=0&view=FitH`} title={doc.fileName} className="block h-[60vh] w-full lg:h-[calc(100dvh-10rem)]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; nothing for next/image to optimise or cache
            <img src={fileUrl} alt={`Uploaded invoice ${doc.fileName}`} className="max-h-[60vh] w-full object-contain lg:max-h-[calc(100dvh-10rem)]" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-bench-ink/70">
          <span>
            {doc.mediaType === "application/pdf" ? "PDF" : "Photo"} · {doc.pages ?? "?"} page{doc.pages === 1 ? "" : "s"} · {(doc.sizeBytes / 1024).toFixed(0)} KB
            {doc.hasText === false && " · no text layer"}
          </span>
          <a href={fileUrl} target="_blank" rel="noreferrer" className="hover:text-white">
            Open original ↗
          </a>
        </div>
      </section>

      <section aria-label="Audit sheet" className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Inbox
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{doc.fileName}</h1>
            <StatusTag doc={doc} />
          </div>
          <Provenance doc={doc} />
        </div>

        {working && !stuck && (
          <Banner tone="info">
            <p>
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-cobalt align-middle" aria-hidden="true" />
              Reading the invoice. This usually takes 10 to 30 seconds.
            </p>
          </Banner>
        )}
        {stuck && (
          <Banner tone="info">
            <p>This is taking much longer than it should; the reading was probably interrupted.</p>
            <RetryButton documentId={doc.id} />
          </Banner>
        )}
        {doc.status === "failed" && (
          <Banner tone="fail" role="alert">
            <p>
              {doc.error ?? "This invoice couldn't be read."}
              {doc.runs >= MAX_RUNS && ` It was tried ${doc.runs} times.`}
            </p>
            {retryable && <RetryButton documentId={doc.id} />}
          </Banner>
        )}
        {doc.status === "approved" && <Approved view={view} />}
        {doc.status === "needs_review" && (
          <Banner tone="flag">
            <p>
              {own
                ? "Some values need a person. Compare the highlighted ones with the original, correct anything that's wrong, and approve."
                : doc.source === "demo"
                  ? "Some values need a person to check them. Every visitor sees this sample, so the review happens on your own copy."
                  : "Some values need a person to check them."}
            </p>
            {!own && doc.source === "demo" && <TrySampleButton documentId={doc.id} />}
          </Banner>
        )}

        {view.fields.length > 0 &&
          (doc.status === "needs_review" && own ? (
            <ReviewForm
              documentId={doc.id}
              initial={currentInvoice(view.fields, view.lineItems)}
              extracted={extractedInvoice(view.fields, view.lineItems)}
              reasons={reasons}
              notes={notes}
              hasText={doc.hasText}
            />
          ) : (
            <ReadOnlySheet view={view} reasons={reasons} notes={notes} />
          ))}
        {view.extractions.length > 0 && <ExtractionLog view={view} />}
      </section>
    </main>
  );
}

const REPORTS = "https://github.com/krishnanbhupathi/docwise-extract/blob/main/docs/measurements";

/** Where a sample (or a visitor's copy of one) came from, and why opening it cost nothing. */
function Provenance({ doc }: { doc: DocumentView["doc"] }) {
  const sample = sampleFor(doc.source === "demo" ? doc.id : (doc.copiedFrom ?? ""));
  if (!sample) return null;
  return (
    <p className="text-sm text-muted">
      {doc.source === "demo" ? (
        <>
          Sample: {sample.label.toLowerCase()}, {sample.detail.toLowerCase()}. Test-set invoice <span className="figures">{sample.invoice}</span>, read with the
          model&rsquo;s saved answer from{" "}
          <a href={`${REPORTS}/${SAMPLE_RUN}.md`} className="underline underline-offset-4 hover:text-ink">
            {SAMPLE_RUN.slice(0, 7)}
          </a>
          , so this page made no model call.
        </>
      ) : (
        <>
          Your private copy of sample{" "}
          <Link href={`/documents/${doc.copiedFrom}`} className="figures underline underline-offset-4 hover:text-ink">
            {sample.invoice}
          </Link>{" "}
          ({sample.label.toLowerCase()}). Your corrections and approval stay in this browser.
        </>
      )}
    </p>
  );
}

function Banner({ tone, role, children }: { tone: "info" | "flag" | "fail" | "ok"; role?: string; children: React.ReactNode }) {
  const look = {
    info: "border-line bg-sheet",
    flag: "border-flag/30 bg-flag-tint text-flag",
    fail: "border-fail/30 bg-fail-tint text-fail",
    ok: "border-cobalt/30 bg-cobalt-tint text-cobalt",
  }[tone];
  return (
    <div role={role} className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm ${look}`}>
      {children}
    </div>
  );
}

function Approved({ view }: { view: DocumentView }) {
  const corrections = view.fields.filter((f) => f.correctedAt).length;
  const auto = view.doc.approval === "auto";
  return (
    <Banner tone="ok">
      <p>
        <span className="font-semibold">{auto ? "Approved automatically: every mark passed." : "Approved by a reviewer"}</span>
        {!auto && (corrections ? ` with ${corrections} correction${corrections === 1 ? "" : "s"}.` : ", as extracted.")}
        {auto && view.doc.hasText === false && " This document has no text layer, so its values couldn't be vouched against it."}
      </p>
      <a href="/export.csv" className="self-start font-medium underline underline-offset-4">
        Download approved invoices (CSV)
      </a>
    </Banner>
  );
}

const AMOUNTS: readonly HeaderField[] = ["subtotal", "tax", "total"];

const extensionMark = (ok: boolean | null): Mark[] =>
  ok === null ? [] : [{ kind: "extended", state: ok ? "pass" : "fail", note: ok ? "quantity × unit price = amount" : "quantity × unit price ≠ amount" }];

/** Read-only audit sheet: the current values (corrections applied), each with its marks. */
function ReadOnlySheet({ view, reasons, notes }: { view: DocumentView; reasons: Partial<Record<FieldName, ConfidenceReason[]>>; notes: Partial<Record<FieldName, string>> }) {
  const data = currentInvoice(view.fields, view.lineItems);
  const extracted = extractedInvoice(view.fields, view.lineItems);
  const rules = checkInvoice(data);
  const edited = new Set(view.fields.filter((f) => f.correctedAt).map((f) => f.name as FieldName));
  const marks = marksFor(data, { rules, reasons, hasText: view.doc.hasText, edited });
  const sums = footings(data);
  const flaggedCount = FIELD_NAMES.filter((name) => flagged(marks[name])).length;

  return (
    <>
      <Sheet
        title="Audit sheet"
        aside={<span className={`text-xs font-medium ${flaggedCount ? "text-fail" : "text-cobalt"}`}>{flaggedCount ? `${flaggedCount} of ${FIELD_NAMES.length} flagged` : "Every mark passed"}</span>}
      >
        {HEADER_FIELDS.map((name) => {
          const value = data[name];
          const fieldNotes = [
            ...(edited.has(name) ? [`corrected · extracted: ${extracted[name] ?? "empty"}`] : []),
            ...(notes[name] && !edited.has(name) ? [`model: “${notes[name]}”`] : []),
          ];
          return (
            <FieldRow key={name} label={FIELD_LABELS[name]} marks={marks[name]} notes={fieldNotes}>
              {value === null ? (
                <span className="text-sm text-muted italic">not on the invoice</span>
              ) : (
                <span className={`${name === "supplier_name" ? "font-medium" : "figures"} break-words`}>
                  <span className={flagged(marks[name]) ? "highlight" : undefined}>{AMOUNTS.includes(name) ? groupDigits(value) : value}</span>
                </span>
              )}
            </FieldRow>
          );
        })}
        <div className="border-t border-line px-4 py-3">
          <MarkLegend />
        </div>
      </Sheet>

      <Sheet
        title={`Line items (${data.line_items.length})`}
        aside={
          <span className="flex items-center gap-2 text-xs text-muted">
            {edited.has("line_items") && "corrected by the reviewer"}
            <MarkChips marks={marks.line_items} />
          </span>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="w-10 px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Description</th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 text-right font-medium">Unit price</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-12 px-4 py-2 text-right font-medium">
                  <span className="sr-only">Extends</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.line_items.map((item, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="figures px-4 py-2 text-muted">{i + 1}</td>
                  <td className="px-2 py-2">{item.description}</td>
                  <td className="figures px-2 py-2 text-right">{item.quantity ?? "–"}</td>
                  <td className="figures px-2 py-2 text-right">{item.unit_price === null ? "–" : groupDigits(item.unit_price)}</td>
                  <td className="figures px-2 py-2 text-right">
                    <span className={rules.lineExtends[i] === false ? "highlight" : undefined}>{groupDigits(item.amount)}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <MarkChips marks={extensionMark(rules.lineExtends[i])} />
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
      </Sheet>
    </>
  );
}

function ExtractionLog({ view }: { view: DocumentView }) {
  const totals = view.extractions.reduce((sum, e) => ({ ms: sum.ms + e.ms, cost: sum.cost + (costUsd(e.model, e.tokensIn, e.tokensOut) ?? 0) }), { ms: 0, cost: 0 });
  return (
    <details className="rounded-2xl border border-line bg-sheet px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Extraction log{" "}
        <span className="figures text-xs font-normal text-muted">
          · {view.extractions.length} call{view.extractions.length === 1 ? "" : "s"} · {(totals.ms / 1000).toFixed(1)} s · ${totals.cost.toFixed(4)}
        </span>
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-muted">
        {view.extractions.map((e) => (
          <li key={e.id} className="font-mono text-[11px] leading-relaxed">
            #{e.attempt} {e.model} · prompt {e.promptVersion} · effort {e.effort} · {e.tokensIn} in / {e.tokensOut} out · {(e.ms / 1000).toFixed(1)} s ·{" "}
            {e.accepted ? "accepted" : e.rawJson === null ? "the API call failed" : `rejected: ${e.errors.join("; ")}`}
            {e.fallbackUsed && " · answered by fallback model"}
          </li>
        ))}
      </ul>
    </details>
  );
}
