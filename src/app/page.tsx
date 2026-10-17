import Link from "next/link";
import { MarkChips, MarkLegend } from "@/components/marks";
import { StatusTag } from "@/components/status";
import { UploadForm } from "@/components/upload-form";
import { db } from "@/db";
import type { Mark } from "@/lib/marks";
import { listDocuments } from "@/server/documents";
import { readWorkspace } from "@/server/workspace";

// Upload actions run extraction in after(), which lives within this function's time limit.
export const maxDuration = 300;

const pass = (kind: Mark["kind"]): Mark => ({ kind, state: "pass", note: "passed" });

/** A specimen of the audit sheet: how a total that doesn't cross-foot gets caught. */
const SPECIMEN: { label: string; value: string; marks: Mark[]; flagged?: boolean }[] = [
  { label: "Subtotal", value: "1,250.00", marks: [pass("vouched"), pass("footed"), { kind: "crossfooted", state: "fail", note: "subtotal + tax ≠ total" }] },
  { label: "VAT 20%", value: "250.00", marks: [pass("vouched"), { kind: "crossfooted", state: "fail", note: "subtotal + tax ≠ total" }] },
  { label: "Total", value: "1,550.00", marks: [pass("vouched"), { kind: "crossfooted", state: "fail", note: "subtotal + tax ≠ total" }], flagged: true },
];

export default async function Inbox() {
  const workspaceId = await readWorkspace();
  const docs = workspaceId ? await listDocuments(db, workspaceId) : [];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-10 sm:py-14">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-4">
          <p className="eyebrow">Supplier invoices · AI extraction</p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Every value read. Every value audited.</h1>
          <p className="max-w-xl text-lg text-muted">
            Docwise extracts the supplier, dates, amounts and line items, then checks each value the way an auditor would: is it on the document, do the lines
            add up, do the totals cross-foot. Values that pass are approved. Anything else waits for a person.
          </p>
        </div>

        <figure className="rounded-2xl border border-line bg-sheet p-5 shadow-[0_1px_0_var(--line),0_12px_32px_-18px_rgb(0_0_0/0.35)]">
          <figcaption className="eyebrow mb-3 flex justify-between">
            <span>Audit sheet</span>
            <span className="text-fail">1 check failed</span>
          </figcaption>
          <dl className="divide-y divide-line">
            {SPECIMEN.map((row) => (
              <div key={row.label} className="flex items-center gap-3 py-2.5">
                <dt className="w-20 text-sm text-muted">{row.label}</dt>
                <dd className="figures flex-1 text-right text-[15px]">
                  <span className={row.flagged ? "highlight" : undefined}>{row.value}</span>
                </dd>
                <dd className="w-[84px]">
                  <MarkChips marks={row.marks} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-fail">1,250.00 + 250.00 = 1,500.00, not 1,550.00: a person checks it.</p>
          <MarkLegend className="mt-4 border-t border-line pt-4" />
        </figure>
      </section>

      <UploadForm />

      {docs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">Your documents</h2>
            <p className="text-xs text-muted">Only this browser can see them.</p>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-line bg-sheet">
            {docs.map((doc) => (
              <li key={doc.id} className="border-b border-line last:border-0">
                <Link href={`/documents/${doc.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sheet-2 sm:grid-cols-[1fr_12rem_auto]">
                  <span className="min-w-0 truncate font-medium">{doc.fileName}</span>
                  <span className="figures order-3 col-span-2 text-xs text-muted sm:order-none sm:col-span-1">
                    {doc.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                  </span>
                  <StatusTag doc={doc} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
