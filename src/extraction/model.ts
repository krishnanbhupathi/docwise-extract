import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, MODEL, SYSTEM_PROMPT } from "./prompt";
import { modelJsonSchema } from "./schema";

export const MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export type InvoiceFile = { data: Uint8Array; mediaType: MediaType };

export type ModelRequest = {
  file: InvoiceFile;
  /** Set on the second attempt: the previous answer and what was wrong with it. */
  retry?: { previousText: string; errors: string[] };
};

export type ModelResponse = {
  text: string;
  /** Model that was asked; `fallbackUsed` says whether another one answered. */
  model: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  fallbackUsed: boolean;
  /** The full API response, logged with the extraction. */
  raw: unknown;
};

/** The one seam to the model, so tests and CI can replay saved responses instead. */
export type CallModel = (request: ModelRequest) => Promise<ModelResponse>;

/**
 * Claude with structured outputs: the answer is constrained to the schema's
 * JSON shape, then parsed with the full Zod schema in extractInvoice.
 * Refusal fallbacks are on ("default" routing): a safety-classifier decline is
 * re-run on Anthropic's recommended fallback model, and the response records it.
 */
export function anthropicModel(apiKey: string, model = MODEL): CallModel {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return async ({ file, retry }) => {
    const data = Buffer.from(file.data).toString("base64");
    const source: Anthropic.Beta.Messages.BetaContentBlockParam =
      file.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: file.mediaType, data } };
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      { role: "user", content: [source, { type: "text", text: "Extract this invoice." }] },
    ];
    if (retry) {
      messages.push({ role: "assistant", content: retry.previousText || "{}" });
      messages.push({ role: "user", content: `That answer doesn't match the required format. Fix these problems and answer with the whole invoice again:\n- ${retry.errors.join("\n- ")}` });
    }
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: modelJsonSchema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const text = response.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text,
      model,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      fallbackUsed: (response.usage.iterations ?? []).some((entry) => entry.type === "fallback_message"),
      raw: response,
    };
  };
}
