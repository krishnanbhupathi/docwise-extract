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
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent/5" : "border-line bg-panel hover:border-accent/60"
        } ${state.busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <span className="text-base font-semibold">{state.busy ? state.step : "Drop an invoice here, or choose a file"}</span>
        <span className="text-sm text-muted">PDF (up to 5 pages) or a photo · JPEG, PNG or WebP · up to 10 MB</span>
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
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
