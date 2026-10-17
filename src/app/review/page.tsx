import type { Metadata } from "next";
import Link from "next/link";
import { MarkLegend } from "@/components/marks";
import { db } from "@/db";
import { REASON_LABELS, type ConfidenceReason } from "@/lib/confidence";
import { FIELD_LABELS, type FieldName } from "@/lib/invoice";
import { listReviewQueue } from "@/server/review";
import { readWorkspace } from "@/server/workspace";

export const metadata: Metadata = { title: "Review queue · Docwise", robots: { index: false } };

export default async function ReviewQueue() {
  const workspaceId = await readWorkspace();
  const queue = workspaceId ? await listReviewQueue(db, workspaceId) : [];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Review queue</p>
        <h1 className="text-3xl font-semibold tracking-tight">{queue.length ? `${queue.length} invoice${queue.length === 1 ? "" : "s"} to check` : "Nothing to check"}</h1>
        <p className="max-w-2xl text-muted">Invoices with at least one value whose marks didn&apos;t all pass, oldest first. Everything else was approved automatically.</p>
      </div>

      {queue.length > 0 && (
        <ul className="overflow-hidden rounded-2xl border border-line bg-sheet">
          {queue.map(({ doc, low }) => (
            <li key={doc.id} className="border-b border-line last:border-0">
              <Link href={`/documents/${doc.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-sheet-2">
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{doc.fileName}</span>
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-flag uppercase">
                    ▲ {low.length} field{low.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {low.map((f) => (
                    <span key={f.name} className="rounded bg-flag-tint px-1.5 py-0.5 text-xs text-flag">
                      <span className="font-semibold">{FIELD_LABELS[f.name as FieldName]}</span>
                      {" · "}
                      {(f.reasons as ConfidenceReason[]).map((r) => REASON_LABELS[r]).join(", ")}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-sheet p-4">
        <MarkLegend />
        <a href="/export.csv" className="self-start text-sm font-medium text-cobalt underline-offset-4 hover:underline">
          Download approved invoices (CSV)
        </a>
      </div>
    </main>
  );
}
