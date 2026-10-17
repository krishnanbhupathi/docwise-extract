import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractInvoice } from "@/extraction/extract";
import type { CallModel, ModelResponse } from "@/extraction/model";
import { pdfText, prepareForModel } from "@/extraction/prepare";
import { allHigh, scoreConfidence } from "@/lib/confidence";
import { costUsd } from "@/lib/pricing";
import type { ManifestEntry } from "@/testset/manifest";
import type { DocOutcome } from "./score";

/**
 * Runs one test invoice through the same steps the app takes (input
 * preparation, extraction with validation and retry, confidence, routing) and
 * returns what happened, plus the model's answers so the run can be replayed.
 */

/** A model answer as saved for replay (an API error is saved as its message). */
export type SavedAttempt = Omit<ModelResponse, "raw"> & { ms: number } | { error: string; ms: number };

export async function runDocument(
  entry: ManifestEntry,
  root: string,
  callModel: CallModel,
  { savedTimes }: { savedTimes?: number[] } = {},
): Promise<{ outcome: DocOutcome; saved: SavedAttempt[] }> {
  const data = new Uint8Array(await readFile(path.join(root, entry.file)));
  const [file, text] = await Promise.all([prepareForModel(data, entry.mediaType), pdfText(data, entry.mediaType)]);
  const result = await extractInvoice(file, callModel);
  // A replay reports the times of the run it replays.
  if (savedTimes) result.attempts.forEach((attempt, i) => (attempt.ms = savedTimes[i] ?? attempt.ms));

  const saved: SavedAttempt[] = result.attempts.map(({ response, ms, errors }) =>
    response ? { text: response.text, model: response.model, stopReason: response.stopReason, inputTokens: response.inputTokens, outputTokens: response.outputTokens, fallbackUsed: response.fallbackUsed, ms } : { error: errors[0] ?? "unknown error", ms },
  );
  const attempts = result.attempts.map(({ response, ms }) => ({
    model: response?.model ?? "unknown",
    stopReason: response?.stopReason ?? null,
    inputTokens: response?.inputTokens ?? 0,
    outputTokens: response?.outputTokens ?? 0,
    ms,
    fallbackUsed: response?.fallbackUsed ?? false,
    costUsd: response ? costUsd(response.model, response.inputTokens, response.outputTokens) : 0,
  }));
  const base = { id: entry.id, kind: entry.kind, expectedRuleFailures: entry.expectedRuleFailures, attempts };

  if (!result.ok) return { outcome: { ...base, route: "failed", extracted: null, confidence: null, error: result.kind }, saved };
  const { uncertain, ...extracted } = result.data;
  const confidence = scoreConfidence(extracted, { uncertain, text });
  return { outcome: { ...base, route: allHigh(confidence) ? "approved" : "needs_review", extracted, confidence, error: null }, saved };
}

/** A model that answers from a saved run, attempt by attempt, so a run can be re-scored for free. */
export function replayModel(saved: SavedAttempt[]): CallModel {
  const queue = [...saved];
  return async () => {
    const next = queue.shift();
    if (!next) throw new Error("replay: no saved answer for this attempt");
    if ("error" in next) throw new Error(next.error);
    return { ...next, raw: null };
  };
}

/** Runs `task` over `items` with at most `limit` at a time; `stop()` returning true halts new starts. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>, stop: () => boolean = () => false): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stop()) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
}
