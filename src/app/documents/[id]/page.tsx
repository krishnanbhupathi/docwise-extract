import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status";
import { db } from "@/db";
import { FIELD_LABELS, HEADER_FIELDS, type FieldName, type InvoiceData } from "@/lib/invoice";
import { costUsd } from "@/lib/pricing";
import { checkInvoice } from "@/lib/rules";
import { getDocument, type DocumentView } from "@/server/documents";
import { getStorage } from "@/server/storage";
import { readWorkspace } from "@/server/workspace";

export const metadata: Metadata = { title: "Invoice · Docwise", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

export default async function DocumentPage({ params }: Props) {
  const { id } = await params;
  const view = await getDocument(db, id, await readWorkspace());
  if (!view) notFound();
  const { doc } = view;
  const fileUrl = await getStorage().createDownloadUrl(doc.fileKey);
  const working = doc.status === "queued" || doc.status === "extracting" || doc.status === "uploading";

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-2">
      {working && <AutoRefresh />}
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

        {working && <p className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">Reading the invoice. This usually takes 10 to 30 seconds.</p>}
        {doc.status === "failed" && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {doc.error ?? "This invoice couldn't be read."}
          </p>
        )}

        {view.fields.length > 0 && <Extracted view={view} />}
        {view.extractions.length > 0 && <ExtractionLog view={view} />}
      </section>
    </main>
  );
}

function Extracted({ view }: { view: DocumentView }) {
  const value = (name: FieldName) => view.fields.find((f) => f.name === name)?.value ?? null;
  const data: InvoiceData = {
    ...(Object.fromEntries(HEADER_FIELDS.map((name) => [name, value(name)])) as Record<(typeof HEADER_FIELDS)[number], string | null>),
    line_items: view.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice, amount: l.amount })),
  };
  // Messages are recomputed from the stored values; the stored rule codes say which fields they flag.
  const { failures } = checkInvoice(data);
  const uncertain = view.fields.filter((f) => f.modelUncertain);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Checks</h2>
        {failures.length === 0 && uncertain.length === 0 ? (
          <p className="rounded-lg bg-ok-bg px-4 py-3 text-sm text-ok">All rule checks passed, and the model reported nothing unclear.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failures.map((f, i) => (
              <li key={i} className="rounded-lg bg-flag-bg px-4 py-2.5 text-sm text-flag">
                <span className="font-semibold">{f.fields.map((name) => FIELD_LABELS[name]).join(", ")}:</span> {f.message}
              </li>
            ))}
            {uncertain.map((f) => (
              <li key={f.id} className="rounded-lg bg-flag-bg px-4 py-2.5 text-sm text-flag">
                <span className="font-semibold">{FIELD_LABELS[f.name as FieldName]}:</span> the model wasn&apos;t sure ({f.modelUncertain})
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
              const field = view.fields.find((f) => f.name === name);
              const flagged = Boolean(field?.ruleFailures.length || field?.modelUncertain);
              return (
                <tr key={name} className={flagged ? "bg-flag-bg/60" : undefined}>
                  <th scope="row" className="w-40 px-4 py-2.5 text-left font-medium text-muted">
                    {FIELD_LABELS[name]}
                  </th>
                  <td className="px-4 py-2.5 font-mono break-all">{field?.value ?? <span className="font-sans text-muted italic">not found</span>}</td>
                  <td className="w-8 pr-3 text-right">{flagged && <span title="Needs checking" aria-label="Needs checking" className="text-flag">⚑</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Line items ({view.lineItems.length})</h2>
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
              {view.lineItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-muted">{item.position}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.quantity ?? "–"}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.unitPrice ?? "–"}</td>
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
            {e.accepted ? "accepted" : `rejected: ${e.errors.join("; ")}`}
            {e.fallbackUsed && " · answered by fallback model"}
          </li>
        ))}
      </ul>
    </details>
  );
}
