"use client";

import { useState, useTransition } from "react";
import { retryExtraction } from "@/app/actions";

export function RetryButton({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryExtraction(documentId);
            setError(result.ok ? null : result.error);
          })
        }
        className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-accent/60 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Try again"}
      </button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
