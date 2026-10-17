import type { CallModel, InvoiceFile, ModelResponse } from "./model";
import { describeIssues, modelOutputSchema, type ModelOutput } from "./schema";

export type Attempt = {
  /** Null when the API call itself failed. */
  response: ModelResponse | null;
  ms: number;
  /** Why this attempt was rejected; empty for the accepted one. */
  errors: string[];
};

export type ExtractResult =
  | { ok: true; data: ModelOutput; attempts: Attempt[] }
  | { ok: false; error: string; attempts: Attempt[] };

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Asks the model for the invoice's fields and accepts only an answer that
 * parses with the Zod schema. A malformed answer goes back once with the exact
 * problems; a second failure is reported, never stored. Every attempt is
 * returned so its tokens and time are logged.
 */
export async function extractInvoice(file: InvoiceFile, callModel: CallModel, { maxAttempts = 2, clock = () => performance.now() } = {}): Promise<ExtractResult> {
  const attempts: Attempt[] = [];
  let retry: { previousText: string; errors: string[] } | undefined;

  for (let i = 0; i < maxAttempts; i++) {
    const started = clock();
    let response: ModelResponse;
    try {
      response = await callModel({ file, retry });
    } catch (error) {
      // The SDK has already retried transient API errors.
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ response: null, ms: Math.round(clock() - started), errors: [message] });
      return { ok: false, error: `The model call failed: ${message}`, attempts };
    }
    const ms = Math.round(clock() - started);

    if (response.stopReason === "refusal") {
      attempts.push({ response, ms, errors: ["The model declined to read this document"] });
      return { ok: false, error: "The model declined to read this document", attempts };
    }
    if (response.stopReason === "max_tokens") {
      attempts.push({ response, ms, errors: ["The answer was cut off at the output limit"] });
      return { ok: false, error: "The answer was cut off at the output limit", attempts };
    }

    const json = parseJson(response.text);
    const errors = json.ok ? [] : ["The answer is not valid JSON"];
    if (json.ok) {
      const parsed = modelOutputSchema.safeParse(json.value);
      if (parsed.success) {
        attempts.push({ response, ms, errors: [] });
        return { ok: true, data: parsed.data, attempts };
      }
      errors.push(...describeIssues(parsed.error));
    }
    attempts.push({ response, ms, errors });
    retry = { previousText: response.text, errors };
  }

  return { ok: false, error: `The answer didn't match the format after ${maxAttempts} attempts: ${attempts.at(-1)!.errors.join("; ")}`, attempts };
}
