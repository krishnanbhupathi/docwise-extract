import { z } from "zod";
import { FIELD_NAMES, type FieldName } from "@/lib/invoice";

/**
 * What the model must return. Shape problems (an amount written "1,234.50",
 * a date as "01/10/2026") fail here and go back to the model once; values
 * that are well formed but wrong (2026-02-30, totals that don't add up) pass
 * here and are caught by the business rules instead.
 */

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a plain decimal like 1234.50 (no currency symbol, no thousands separators)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date like 2026-10-19");

export const modelOutputSchema = z.object({
  supplier_name: z.string().min(1).nullable().describe("The company that issued the invoice (the seller), not the customer."),
  invoice_number: z.string().min(1).nullable().describe("Exactly as printed, including any prefix."),
  invoice_date: isoDate.nullable(),
  due_date: isoDate.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code like EUR").nullable(),
  subtotal: decimal.nullable().describe("Total before tax, as printed."),
  tax: decimal.nullable().describe("Total tax amount, as printed. If tax is split (e.g. CGST + SGST), the sum. Null if the invoice shows no tax."),
  total: decimal.nullable().describe("Amount due including tax, as printed."),
  line_items: z
    .array(
      z.object({
        description: z.string(),
        quantity: decimal.nullable(),
        unit_price: decimal.nullable(),
        amount: decimal,
      }),
    )
    .max(200),
  uncertain: z
    .array(
      z.object({
        field: z.enum(FIELD_NAMES as [FieldName, ...FieldName[]]),
        reason: z.string().max(300),
      }),
    )
    .max(20)
    .describe("Fields you could not read with confidence (illegible, ambiguous, conflicting), with a short reason. Empty if none."),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/**
 * Structured outputs accept a subset of JSON Schema, so the schema sent to the
 * model drops patterns and length limits. They still apply: every answer is
 * parsed with the full Zod schema, and a violation goes back to the model.
 */
const UNSUPPORTED = new Set(["maxItems", "minItems", "maxLength", "minLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "$schema"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) if (!UNSUPPORTED.has(key)) out[key] = strip(value);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export const modelJsonSchema = strip(z.toJSONSchema(modelOutputSchema, { target: "draft-7" })) as Record<string, unknown>;

/** Zod errors as short lines the model can act on: "line_items.2.amount: must be a plain decimal…". */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
