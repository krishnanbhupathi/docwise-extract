import type { documents } from "@/db/schema";

type Doc = Pick<typeof documents.$inferSelect, "status" | "approval">;

/** The document's verdict, as a tag on the audit sheet. */
export function StatusTag({ doc }: { doc: Doc }) {
  const base = "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase";
  switch (doc.status) {
    case "approved":
      return <span className={`${base} bg-cobalt text-cobalt-ink`}>✓ Approved · {doc.approval === "auto" ? "auto" : "reviewed"}</span>;
    case "needs_review":
      return <span className={`${base} bg-flag-tint text-flag ring-1 ring-flag/30 ring-inset`}>▲ Needs review</span>;
    case "extracting":
      return (
        <span className={`${base} bg-cobalt-tint text-cobalt`}>
          <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
          Reading
        </span>
      );
    case "failed":
      return <span className={`${base} bg-fail-tint text-fail`}>✗ Failed</span>;
    default:
      return <span className={`${base} border border-line text-muted`}>Waiting</span>;
  }
}
