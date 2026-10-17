import { describe, expect, it, vi } from "vitest";
import { extractInvoice } from "./extract";
import type { CallModel, ModelRequest, ModelResponse } from "./model";
import { modelJsonSchema } from "./schema";

const file = { data: new Uint8Array([37, 80, 68, 70]), mediaType: "application/pdf" as const };

const good = {
  supplier_name: "Copperleaf Studio Ltd",
  invoice_number: "INV-2041",
  invoice_date: "2026-10-01",
  due_date: null,
  currency: "GBP",
  subtotal: "100.00",
  tax: "20.00",
  total: "120.00",
  line_items: [{ description: "Design", quantity: "1", unit_price: "100.00", amount: "100.00" }],
  uncertain: [],
};

const reply = (text: string, patch: Partial<ModelResponse> = {}): ModelResponse => ({
  text,
  model: "claude-opus-5-5",
  stopReason: "end_turn",
  inputTokens: 1500,
  outputTokens: 400,
  fallbackUsed: false,
  raw: { text },
  ...patch,
});

/** A fake model that answers from a script and records what it was asked. */
function scripted(...answers: Array<ModelResponse | Error>) {
  const requests: ModelRequest[] = [];
  const call: CallModel = vi.fn(async (request) => {
    requests.push(request);
    const next = answers.shift();
    if (!next) throw new Error("no more scripted answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return { call, requests };
}

describe("extractInvoice", () => {
  it("accepts a valid answer on the first attempt", async () => {
    const { call } = scripted(reply(JSON.stringify(good)));
    const result = await extractInvoice(file, call);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.total).toBe("120.00");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].errors).toEqual([]);
  });

  it("sends schema problems back once, then accepts the fixed answer", async () => {
    const formatted = { ...good, total: "1,20.00", invoice_date: "01/10/2026" };
    const { call, requests } = scripted(reply(JSON.stringify(formatted)), reply(JSON.stringify(good)));
    const result = await extractInvoice(file, call);
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(requests[1].retry?.errors).toEqual([
      "invoice_date: must be an ISO date like 2026-10-19",
      "total: must be a plain decimal like 1234.50 (no currency symbol, no thousands separators)",
    ]);
    expect(requests[1].retry?.previousText).toBe(JSON.stringify(formatted));
  });

  it("reports failure after two bad answers and returns nothing to store", async () => {
    const { call } = scripted(reply("not json"), reply(JSON.stringify({ ...good, line_items: "none" })));
    const result = await extractInvoice(file, call);
    expect(result.ok).toBe(false);
    expect("data" in result).toBe(false);
    expect(result.attempts.map((a) => a.errors[0])).toEqual(["The answer is not valid JSON", "line_items: Invalid input: expected array, received string"]);
  });

  it("does not retry a refusal, a truncated answer or an API error", async () => {
    for (const answer of [reply("", { stopReason: "refusal" }), reply("{", { stopReason: "max_tokens" }), new Error("overloaded")]) {
      const { call } = scripted(answer);
      const result = await extractInvoice(file, call);
      expect(result.ok).toBe(false);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("times every attempt", async () => {
    let t = 0;
    const { call } = scripted(reply("nope"), reply(JSON.stringify(good)));
    const result = await extractInvoice(file, call, { clock: () => (t += 1000) });
    expect(result.attempts.map((a) => a.ms)).toEqual([1000, 1000]);
  });
});

describe("modelJsonSchema", () => {
  it("is a strict object schema without keywords structured outputs rejects", () => {
    const text = JSON.stringify(modelJsonSchema);
    expect(modelJsonSchema.additionalProperties).toBe(false);
    for (const keyword of ['"pattern"', '"maxItems"', '"minLength"', '"$schema"']) expect(text).not.toContain(keyword);
    expect(modelJsonSchema.required).toEqual(Object.keys(good));
  });
});
