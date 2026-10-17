/**
 * Anthropic list prices in US dollars per million tokens, used to turn logged
 * token counts into cost per document. Source: Anthropic's published pricing,
 * checked on Day 1 of the build. Thinking tokens are billed (and counted) as output.
 */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

/** Cost in US dollars, or null for a model without a listed price. */
export function costUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const price = PRICES_PER_MTOK[model];
  if (!price) return null;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}
