import { db } from "@/db";
import { toCsv } from "@/lib/csv";
import { listApproved } from "@/server/review";
import { readWorkspace } from "@/server/workspace";

/** Approved invoices (this browser's and the demo's) as CSV, with reviewers' corrections applied. */
export async function GET() {
  const approved = await listApproved(db, await readWorkspace());
  const csv = toCsv(
    approved.map(({ doc, invoice, corrected }) => ({ id: doc.id, fileName: doc.fileName, invoice, approval: doc.approval, corrected, approvedAt: doc.approvedAt })),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="docwise-approved-invoices.csv"',
      "cache-control": "private, no-store",
    },
  });
}
