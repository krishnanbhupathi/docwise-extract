import { MARK_NAMES, type Mark, type MarkKind } from "@/lib/marks";

/** Drawn rather than typed: ✓ Σ ⊕ fall back to different system fonts and come out at different sizes. */
const PATHS: Record<MarkKind, React.ReactNode> = {
  vouched: <path d="M3.5 8.6l3 3 6-7.2" />,
  extended: <path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" />,
  footed: <path d="M11.8 3.6H4.6L8.6 8l-4 4.4h7.2" />,
  crossfooted: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 5.4v5.2M5.4 8h5.2" />
    </>
  ),
  valid: (
    <>
      <path d="M8 3.5v5.8" />
      <circle cx="8" cy="12.2" r=".6" />
    </>
  ),
  unsure: (
    <>
      <path d="M5.9 6.1a2.2 2.2 0 1 1 3.2 1.9c-.7.4-1.1.9-1.1 1.7" />
      <circle cx="8" cy="12.3" r=".6" />
    </>
  ),
};

export function MarkGlyph({ kind, className = "size-4" }: { kind: MarkKind; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind]}
    </svg>
  );
}

const LOOK = {
  pass: "bg-cobalt-tint text-cobalt",
  fail: "bg-fail-tint text-fail ring-1 ring-inset ring-fail/40",
  open: "border border-dashed border-muted/50 text-muted",
} as const;

/** One field's tick marks as small square chips; the full meaning is in the title and for screen readers. */
export function MarkChips({ marks, className = "" }: { marks: readonly Mark[]; className?: string }) {
  if (!marks.length) return null;
  return (
    <span className={`inline-flex shrink-0 gap-1 ${className}`}>
      {marks.map((m, i) => (
        <span key={i} title={`${MARK_NAMES[m.kind]}: ${m.note}`} className={`grid size-6 place-items-center rounded-[5px] ${LOOK[m.state]}`}>
          <MarkGlyph kind={m.kind} className="size-3.5" />
          <span className="sr-only">
            {MARK_NAMES[m.kind]}: {m.note}.
          </span>
        </span>
      ))}
    </span>
  );
}

const LEGEND: { kind: MarkKind; label: string }[] = [
  { kind: "vouched", label: "found on the document" },
  { kind: "extended", label: "qty × price = amount" },
  { kind: "footed", label: "lines add up" },
  { kind: "crossfooted", label: "subtotal + tax = total" },
  { kind: "unsure", label: "model unsure" },
];

/** The key to the marks, in the vernacular an auditor would use. */
export function MarkLegend({ className = "" }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted ${className}`}>
      {LEGEND.map(({ kind, label }) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded-[4px] bg-cobalt-tint text-cobalt">
            <MarkGlyph kind={kind} className="size-3" />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
