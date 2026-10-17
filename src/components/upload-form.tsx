"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finishUpload, requestUpload } from "@/app/actions";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const BY_EXTENSION: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Some browsers leave `type` empty for PDFs; fall back to the extension. */
const typeOf = (file: File) => file.type || BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";

/**
 * Upload in three steps: ask the server for a signed URL, send the file
 * straight to storage (Vercel functions cap request bodies at 4.5 MB), then
 * ask the server to check it and start extraction.
 */
export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; step?: string; error?: string }>({ busy: false });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setState({ busy: true, step: "Preparing upload…" });
    try {
      const started = await requestUpload({ fileName: file.name, mediaType: typeOf(file), sizeBytes: file.size });
      if (!started.ok) return setState({ busy: false, error: started.error });
      setState({ busy: true, step: "Uploading…" });
      const put = await fetch(started.uploadUrl, { method: "PUT", body: file, headers: { "content-type": typeOf(file) } });
      if (!put.ok) return setState({ busy: false, error: "The upload failed. Please try again." });
      setState({ busy: true, step: "Checking the file…" });
      const finished = await finishUpload(started.id);
      if (!finished.ok) return setState({ busy: false, error: finished.error });
      router.push(`/documents/${started.id}`);
    } catch {
      setState({ busy: false, error: "The upload failed. Check your connection and try again." });
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !state.busy) void upload(file);
        }}
        className={`bench flex cursor-pointer flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center transition-shadow ${
          dragging ? "shadow-[inset_0_0_0_2px_var(--cobalt)]" : "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--bench-ink)_22%,transparent)] hover:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--cobalt)_70%,transparent)]"
        } ${state.busy ? "pointer-events-none" : ""}`}
      >
        <svg viewBox="0 0 48 48" className="size-11 text-bench-ink/80" aria-hidden="true">
          <path d="M14 6h14l8 8v28H14z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M28 6v8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M19 27l4 4 8-9" fill="none" stroke="var(--cobalt)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 37h14" stroke="#ffe066" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <span className="text-lg font-semibold text-white">
          {state.busy ? (
            <span className="inline-flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-[#ffe066]" aria-hidden="true" />
              {state.step}
            </span>
          ) : (
            "Drop an invoice on the bench, or choose a file"
          )}
        </span>
        <span className="font-mono text-xs text-bench-ink/70">PDF up to 5 pages · JPEG, PNG or WebP photo · 10 MB max</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={state.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-fail">
          {state.error}
        </p>
      )}
    </div>
  );
}
