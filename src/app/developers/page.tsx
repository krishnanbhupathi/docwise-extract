import type { Metadata } from "next";
import { headers } from "next/headers";
import { ApiKeys } from "@/components/api-keys";
import { db } from "@/db";
import { MAX_PAGES } from "@/extraction/prepare";
import { MAX_KEYS_PER_WORKSPACE, listApiKeys } from "@/server/api-keys";
import { API_MAX_BYTES } from "@/server/documents";
import { DAILY_BUDGET_USD, DAILY_UPLOAD_LIMIT, RATE_LIMITS } from "@/server/limits";
import { readWorkspace } from "@/server/workspace";

export const metadata: Metadata = { title: "API · Docwise" };

const AUTH = '-H "Authorization: Bearer $DOCWISE_KEY"';

export default async function Developers() {
  const workspaceId = await readWorkspace();
  const keys = workspaceId ? await listApiKeys(db, workspaceId) : [];
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  const endpoints: { method: string; path: string; what: string; curl: string; notes?: string }[] = [
    {
      method: "POST",
      path: "/api/v1/invoices",
      what: "Send an invoice as multipart form data in a field named file. Answers 202 with the invoice, status queued; the model reads it in the background.",
      curl: `curl -X POST ${origin}/api/v1/invoices \\\n  ${AUTH} \\\n  -F file=@invoice.pdf`,
    },
    {
      method: "GET",
      path: "/api/v1/invoices/:id",
      what: "One invoice: status, the values (corrections applied), what the model read, each field's confidence and why, the checks that fail, and the model's tokens, time and cost. Poll until status is needs_review, approved or failed. Samples can be read too.",
      curl: `curl ${origin}/api/v1/invoices/sample-056 \\\n  ${AUTH}`,
    },
    {
      method: "GET",
      path: "/api/v1/invoices",
      what: "This key's invoices, newest first. Optional: status (queued, extracting, needs_review, approved, failed) and limit (1 to 100, default 20).",
      curl: `curl "${origin}/api/v1/invoices?status=needs_review" \\\n  ${AUTH}`,
    },
    {
      method: "POST",
      path: "/api/v1/invoices/:id/approve",
      what: "Approve an invoice waiting for review. Send only the fields you correct; the rest keep their values, and corrections are stored beside the extracted ones. Add \"accept_failing_checks\": true to approve an invoice that doesn't add up as printed.",
      curl: `curl -X POST ${origin}/api/v1/invoices/ID/approve \\\n  ${AUTH} \\\n  -H "Content-Type: application/json" \\\n  -d '{"invoice": {"total": "6782.62"}}'`,
    },
  ];

  const errors: [string, string][] = [
    ["400", "The request is malformed: no file, bad JSON, an unknown field or status"],
    ["401", "No key, or a key that doesn't exist (revoked keys stop working at once)"],
    ["403", "Approving a sample: they're shared by every visitor"],
    ["404", "No invoice with that id for this key"],
    ["409", "The invoice isn't waiting for review"],
    ["413 · 415", `The file is over ${API_MAX_BYTES / 1024 / 1024} MB, or isn't a PDF, JPEG, PNG or WebP (judged by its bytes, not its name)`],
    ["422", `A PDF that can't be opened or has more than ${MAX_PAGES} pages; values that can't be approved (details lists them)`],
    ["429", "A rate limit or the demo's daily cap; Retry-After says when to try again"],
  ];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-10 sm:py-14">
      <section className="flex max-w-3xl flex-col gap-4">
        <p className="eyebrow">Developers · API v1</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">The same flow, as JSON.</h1>
        <p className="text-lg text-muted">
          Send an invoice, read back every value with its confidence and the checks it failed, and approve it with corrections. A key acts for this
          browser, so invoices you send with it also appear in your inbox and review queue.
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-labelledby="keys" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:order-2">
          <h2 id="keys" className="eyebrow">
            Your API keys
          </h2>
          <ApiKeys keys={keys} max={MAX_KEYS_PER_WORKSPACE} />
        </section>

        <div className="flex min-w-0 flex-col gap-8 lg:order-1">
          <section aria-labelledby="endpoints" className="flex flex-col gap-4">
            <h2 id="endpoints" className="eyebrow">
              Endpoints
            </h2>
            {endpoints.map((e) => (
              <article key={`${e.method} ${e.path}`} className="overflow-hidden rounded-2xl border border-line bg-sheet">
                <header className="flex flex-wrap items-baseline gap-3 border-b border-line bg-sheet-2 px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${e.method === "GET" ? "bg-cobalt-tint text-cobalt" : "bg-cobalt text-cobalt-ink"}`}>{e.method}</span>
                  <code className="figures break-all">{e.path}</code>
                </header>
                <div className="flex flex-col gap-3 px-4 py-4">
                  <p className="max-w-prose text-sm">{e.what}</p>
                  <pre className="overflow-x-auto rounded-lg bg-bench p-3 font-mono text-[12.5px] leading-relaxed text-bench-ink">
                    <code>{e.curl}</code>
                  </pre>
                </div>
              </article>
            ))}
          </section>

          <section aria-labelledby="errors" className="flex flex-col gap-3">
            <h2 id="errors" className="eyebrow">
              Errors
            </h2>
            <p className="max-w-prose text-sm text-muted">
              Every error is JSON: <code className="figures">{'{"error": {"code", "message", "details"?}}'}</code>, with a stable code to branch on.
            </p>
            <dl className="overflow-hidden rounded-2xl border border-line bg-sheet text-sm">
              {errors.map(([status, meaning]) => (
                <div key={status} className="grid grid-cols-[5.5rem_1fr] gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <dt className="figures text-muted">{status}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="limits" className="flex flex-col gap-3">
            <h2 id="limits" className="eyebrow">
              Limits
            </h2>
            <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-sm">
              <li>{RATE_LIMITS.requestsPerKey.max} requests a minute per key.</li>
              <li>{RATE_LIMITS.uploadsPerIp.max} uploads an hour per network, shared with uploads from the browser.</li>
              <li>
                Files up to {API_MAX_BYTES / 1024 / 1024} MB; PDFs up to {MAX_PAGES} pages.
              </li>
              <li>
                This is a public demo on one API budget: across all visitors, {DAILY_UPLOAD_LIMIT} uploads and ${DAILY_BUDGET_USD.toFixed(2)} of model use per 24
                hours. Samples cost nothing and always work.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
