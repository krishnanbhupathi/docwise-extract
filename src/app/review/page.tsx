import type { Metadata } from "next";
import Link from "next/link";
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Review queue</h1>
        <p className="text-muted">
          Invoices with at least one value Docwise isn&apos;t sure of, oldest first. Everything else was approved automatically.
        </p>
      </div>

      {queue.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-muted">Nothing to review.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {queue.map(({ doc, low }) => (
            <li key={doc.id}>
              <Link href={`/documents/${doc.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-paper">
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{doc.fileName}</span>
                  <span className="shrink-0 text-sm text-flag">
                    {low.length} field{low.length === 1 ? "" : "s"} to check
                  </span>
                </span>
                <span className="text-sm text-muted">
                  {low.map((f) => `${FIELD_LABELS[f.name as FieldName]} (${(f.reasons as ConfidenceReason[]).map((r) => REASON_LABELS[r]).join(", ")})`).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <a href="/export.csv" className="self-start text-sm font-medium text-accent underline-offset-4 hover:underline">
        Download approved invoices (CSV)
      </a>
    </main>
  );
}
