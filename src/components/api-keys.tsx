"use client";

import { useState, useTransition } from "react";
import { createKey, revokeKey } from "@/app/actions";

type Key = { id: string; prefix: string; label: string; createdAt: Date; lastUsedAt: Date | null };

const when = (date: Date) => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** Create, copy (once) and revoke this browser's API keys. */
export function ApiKeys({ keys, max }: { keys: Key[]; max: number }) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = () =>
    startTransition(async () => {
      const result = await createKey(label);
      setError(result.ok ? null : result.error);
      if (result.ok) {
        setCreated(result.key);
        setCopied(false);
        setLabel("");
      }
    });

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokeKey(id);
      setError(result.ok ? null : result.error);
      setConfirming(null);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created!);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="sr-only" htmlFor="key-label">
          What the key is for
        </label>
        <input
          id="key-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="What it's for, e.g. staging"
          className="min-w-0 flex-1 rounded-md border border-line bg-sheet px-3 py-2 text-sm outline-none focus:border-cobalt"
        />
        <button type="submit" disabled={pending || keys.length >= max} className="rounded-md bg-cobalt px-4 py-2 text-sm font-semibold text-cobalt-ink disabled:opacity-45">
          Create key
        </button>
      </form>

      {created && (
        <div className="flex flex-col gap-2 rounded-xl border border-cobalt/30 bg-cobalt-tint p-4" role="status">
          <p className="text-sm font-medium text-cobalt">Copy your key now. It won&rsquo;t be shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="figures min-w-0 flex-1 rounded-md bg-sheet px-3 py-2 break-all select-all" data-testid="new-api-key">
              {created}
            </code>
            <button type="button" onClick={copy} className="rounded-md border border-line bg-sheet px-3 py-2 text-sm font-medium hover:border-cobalt/60">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-fail">
          {error}
        </p>
      )}

      {keys.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-line bg-sheet">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="figures">{key.prefix}…</span>
                <span className="min-w-0 flex-1 truncate text-sm">{key.label}</span>
                {confirming === key.id ? (
                  <span className="flex gap-2">
                    <button type="button" disabled={pending} onClick={() => revoke(key.id)} className="rounded-md bg-fail px-2.5 py-1 text-xs font-semibold text-sheet disabled:opacity-50">
                      Revoke {key.prefix}…
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-line px-2.5 py-1 text-xs">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(key.id)} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-fail/50 hover:text-fail">
                    Revoke
                  </button>
                )}
              </div>
              <span className="text-xs text-muted">
                Created {when(key.createdAt)} · {key.lastUsedAt ? `last used ${when(key.lastUsedAt)}` : "never used"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No keys yet. A key acts for this browser: invoices you send with it appear in your inbox and review queue.</p>
      )}
      <p className="text-xs text-muted">
        Up to {max} keys per browser. Only a hash of each key is stored.
      </p>
    </div>
  );
}
