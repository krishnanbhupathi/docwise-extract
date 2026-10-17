import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { UploadForm } from "@/components/upload-form";
import { db } from "@/db";
import { listDocuments } from "@/server/documents";
import { readWorkspace } from "@/server/workspace";

// Upload actions run extraction in after(), which lives within this function's time limit.
export const maxDuration = 300;

export default async function Home() {
  const workspaceId = await readWorkspace();
  const docs = workspaceId ? await listDocuments(db, workspaceId) : [];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-balance">Supplier invoices, read and checked</h1>
        <p className="max-w-2xl text-muted">
          Upload an invoice and Docwise extracts the supplier, dates, amounts and line items. Every value is checked by rules (dates exist, line items add
          up, subtotal plus tax equals the total), and anything that fails goes to a person instead of straight into your books.
        </p>
      </section>

      <UploadForm />

      {docs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Your documents</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {docs.map((doc) => (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <span className="min-w-0 flex-1 truncate font-medium">{doc.fileName}</span>
                  <span className="hidden text-sm text-muted sm:inline">
                    {doc.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                  </span>
                  <StatusBadge status={doc.status} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Only this browser can see the documents it uploaded.</p>
        </section>
      )}
    </main>
  );
}
