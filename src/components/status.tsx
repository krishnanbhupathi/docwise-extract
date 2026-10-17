import type { documents } from "@/db/schema";

type Status = (typeof documents.$inferSelect)["status"];

const LOOK: Record<Status, { label: string; className: string }> = {
  uploading: { label: "Uploading", className: "bg-line text-muted" },
  queued: { label: "Waiting", className: "bg-line text-muted" },
  extracting: { label: "Reading", className: "bg-accent/10 text-accent" },
  needs_review: { label: "Needs review", className: "bg-flag-bg text-flag" },
  approved: { label: "Approved", className: "bg-ok-bg text-ok" },
  failed: { label: "Failed", className: "bg-danger/10 text-danger" },
};

export function StatusBadge({ status }: { status: Status }) {
  const look = LOOK[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${look.className}`}>{look.label}</span>;
}
