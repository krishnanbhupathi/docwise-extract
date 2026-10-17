import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { RetryButton } from "@/components/retry-button";
import { ReviewForm, type FieldFlags } from "@/components/review-form";
import { StatusBadge } from "@/components/status";
import { db } from "@/db";
import { REASON_LABELS, type ConfidenceReason } from "@/lib/confidence";
import { FIELD_LABELS, HEADER_FIELDS, type FieldName } from "@/lib/invoice";
import { costUsd } from "@/lib/pricing";
import { checkInvoice } from "@/lib/rules";
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

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-2">
      {working && !stuck && <AutoRefresh />}
      <section aria-label="Original document" className="lg:sticky lg:top-6 lg:self-start">
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          {doc.mediaType === "application/pdf" ? (
            <iframe src={`${fileUrl}#view=FitH`} title={doc.fileName} className="h-[70vh] w-full lg:h-[82vh]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; nothing for next/image to optimise or cache
            <img src={fileUrl} alt={`Uploaded invoice ${doc.fileName}`} className="max-h-[82vh] w-full object-contain" />
          )}
        </div>
        <a href={fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-muted underline-offset-4 hover:underline">
          Open the original in a new tab
        </a>
      </section>

      <section aria-label="Extracted data" className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← All documents
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight">{doc.fileName}</h1>
            <StatusBadge status={doc.status} />
          </div>
          <p className="text-sm text-muted">
            {doc.pages ?? "?"} page{doc.pages === 1 ? "" : "s"} · {(doc.sizeBytes / 1024).toFixed(0)} KB
          </p>
        </div>

        {working && !stuck && <p className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">Reading the invoice. This usually takes 10 to 30 seconds.</p>}
        {stuck && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
            <p>This is taking much longer than it should; the reading was probably interrupted.</p>
            <RetryButton documentId={doc.id} />
          </div>
        )}
        {doc.status === "failed" && (
          <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <p>
              {doc.error ?? "This invoice couldn't be read."}
              {doc.runs >= MAX_RUNS && ` It was tried ${doc.runs} times.`}
            </p>
            {retryable && <RetryButton documentId={doc.id} />}
          </div>
        )}
        {doc.status === "approved" && <Approved view={view} />}
        {doc.status === "needs_review" && (
          <p className="rounded-lg border border-flag/30 bg-flag-bg px-4 py-3 text-sm text-flag">
            {own
              ? "Some values need a person to check them. Compare the flagged fields with the original, correct anything that's wrong and approve."
              : "Some values need a person to check them."}
          </p>
        )}

        {view.fields.length > 0 &&
          (doc.status === "needs_review" && own ? (
            <ReviewForm documentId={doc.id} initial={currentInvoice(view.fields, view.lineItems)} extracted={extractedInvoice(view.fields, view.lineItems)} flags={fieldFlags(view)} />
          ) : (
            <Extracted view={view} />
          ))}
        {doc.hasText === false && view.fields.length > 0 && (
          <p className="text-xs text-muted">This document has no text layer (a scan or a photo), so values were checked by the rules and the model&apos;s own doubts only.</p>
        )}
        {view.extractions.length > 0 && <ExtractionLog view={view} />}
      </section>
    </main>
  );
}

/** The extraction's own flags per field (rule failures excluded: those are recomputed from the current values). */
function fieldFlags(view: DocumentView): FieldFlags {
  const flags: FieldFlags = {};
  for (const field of view.fields) {
    const reasons = (field.confidenceReasons as ConfidenceReason[]).filter((r) => !r.startsWith("rule:"));
    if (reasons.length) flags[field.name as FieldName] = { reasons, note: field.modelUncertain };
  }
  return flags;
}

function Approved({ view }: { view: DocumentView }) {
  const corrections = view.fields.filter((f) => f.correctedAt).length;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">
      <p className="font-medium">
        {view.doc.approval === "auto"
          ? "Approved automatically."
          : `Approved by a reviewer${corrections ? ` with ${corrections} correction${corrections === 1 ? "" : "s"}` : ""}.`}
      </p>
      {view.doc.approval === "auto" && (
        <p>
          Every rule check passed and the model reported nothing unclear
          {view.doc.hasText ? ", and every value was found in the document's own text." : "."}
        </p>
      )}
      <a href="/export.csv" className="mt-1 self-start font-medium underline underline-offset-4">
        Download approved invoices (CSV)
      </a>
    </div>
  );
}

/** Read-only view: the current values (corrections applied), with what was flagged and what a reviewer changed. */
function Extracted({ view }: { view: DocumentView }) {
  const data = currentInvoice(view.fields, view.lineItems);
  const extracted = extractedInvoice(view.fields, view.lineItems);
  const { failures } = checkInvoice(data);
  const field = (name: FieldName) => view.fields.find((f) => f.name === name);
  const lowReasons = (name: FieldName) => {
    const row = field(name);
    if (row?.confidence !== "low") return null;
    const reasons = (row.confidenceReasons as ConfidenceReason[]).map((r) => (r === "model_uncertain" && row.modelUncertain ? `${REASON_LABELS[r]}: ${row.modelUncertain}` : REASON_LABELS[r]));
    return `flagged at extraction: ${reasons.join(" · ")}`;
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Checks</h2>
        {failures.length === 0 ? (
          <p className="rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">All rule checks pass.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failures.map((f, i) => (
              <li key={i} className="rounded-lg bg-flag-bg px-4 py-2.5 text-sm text-flag">
                <span className="font-semibold">{f.fields.map((name) => FIELD_LABELS[name]).join(", ")}:</span> {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <caption className="sr-only">Extracted fields</caption>
          <tbody className="divide-y divide-line">
            {HEADER_FIELDS.map((name) => {
              const row = field(name);
              const reasons = lowReasons(name);
              return (
                <tr key={name} className={reasons ? "bg-flag-bg/60" : undefined}>
                  <th scope="row" className="w-40 px-4 py-2.5 text-left align-top font-medium text-muted">
                    {FIELD_LABELS[name]}
                  </th>
                  <td className="px-4 py-2.5">
                    <span className="font-mono break-all">{data[name] ?? <span className="font-sans text-muted italic">not found</span>}</span>
                    {row?.correctedAt && (
                      <span className="block text-xs text-muted">
                        corrected · extracted: <span className="font-mono">{extracted[name] ?? "empty"}</span>
                      </span>
                    )}
                    {reasons && <span className="block text-xs text-flag">{reasons}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          Line items ({data.line_items.length}){field("line_items")?.correctedAt && <span className="ml-2 font-normal normal-case">corrected by the reviewer</span>}
        </h2>
        {lowReasons("line_items") && <p className="text-xs text-flag">{lowReasons("line_items")}</p>}
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.line_items.map((item, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.quantity ?? "–"}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.unit_price ?? "–"}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ExtractionLog({ view }: { view: DocumentView }) {
  const totals = view.extractions.reduce((sum, e) => ({ ms: sum.ms + e.ms, cost: sum.cost + (costUsd(e.model, e.tokensIn, e.tokensOut) ?? 0) }), { ms: 0, cost: 0 });
  return (
    <details className="rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Extraction log · {view.extractions.length} call{view.extractions.length === 1 ? "" : "s"} · {(totals.ms / 1000).toFixed(1)} s · ${totals.cost.toFixed(4)}
      </summary>
      <ul className="mt-3 flex flex-col gap-2 text-muted">
        {view.extractions.map((e) => (
          <li key={e.id} className="font-mono text-xs">
            #{e.attempt} {e.model} · prompt {e.promptVersion} · effort {e.effort} · {e.tokensIn} in / {e.tokensOut} out · {(e.ms / 1000).toFixed(1)} s ·{" "}
            {e.accepted ? "accepted" : e.rawJson === null ? "the API call failed" : `rejected: ${e.errors.join("; ")}`}
            {e.fallbackUsed && " · answered by fallback model"}
          </li>
        ))}
      </ul>
    </details>
  );
}
