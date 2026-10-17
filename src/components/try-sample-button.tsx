"use client";

import { useState, useTransition } from "react";
import { trySample } from "@/app/actions";

/** Opens this browser's private copy of a sample, to review it without changing it for anyone else. */
export function TrySampleButton({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await trySample(documentId);
            // On success the action redirects to the copy.
            if (result && !result.ok) setError(result.error);
          })
        }
        className="rounded-md bg-cobalt px-3 py-1.5 text-sm font-semibold text-cobalt-ink hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Copying…" : "Review your own copy →"}
      </button>
      {error && <span className="text-sm text-fail">{error}</span>}
    </div>
  );
}
