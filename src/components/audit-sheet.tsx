import type { ReactNode } from "react";
import type { Mark, MarkKind } from "@/lib/marks";
import { MarkChips, MarkGlyph } from "./marks";

/**
 * The audit sheet's building blocks, shared by the read-only view and the
 * review form so both read the same: label, value, and the value's tick marks
 * on the right, with failed checks spelled out underneath.
 */

export function Sheet({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-sheet">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sheet-2 px-4 py-2.5">
        <h2 className="eyebrow">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function FieldRow({ label, htmlFor, marks, notes = [], children }: { label: string; htmlFor?: string; marks: readonly Mark[]; notes?: ReactNode[]; children: ReactNode }) {
  const failed = marks.filter((m) => m.state === "fail");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="col-span-2 text-sm text-muted sm:col-span-1">
          {label}
        </label>
      ) : (
        <span className="col-span-2 text-sm text-muted sm:col-span-1">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
      <MarkChips marks={marks} className="justify-self-end" />
      {(failed.length > 0 || notes.length > 0) && (
        <p className="col-span-2 text-xs sm:col-start-2">
          {failed.map((m, i) => (
            <span key={i} className="text-fail">
              {i > 0 && " · "}
              {m.note}
            </span>
          ))}
          {notes.map((note, i) => (
            <span key={`n${i}`} className="text-muted">
              {(failed.length > 0 || i > 0) && " · "}
              {note}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** A footing line under the line items: what the lines add up to, and what that is checked against. */
export function TotalRow({ kind, label, value, marks, against }: { kind: MarkKind; label: string; value: string; marks: readonly Mark[]; against?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <span className="col-start-1 row-start-1 flex items-center gap-1.5 text-muted">
        <MarkGlyph kind={kind} className="size-3.5" />
        {label}
      </span>
      <span className="col-span-2 row-start-2 text-right sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="figures">{value}</span>
        {against && <span className="figures ml-2 text-muted">{against}</span>}
      </span>
      <MarkChips marks={marks} className="col-start-2 row-start-1 sm:col-start-3" />
    </div>
  );
}
