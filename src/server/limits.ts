import { and, count, eq, gt, isNull, lt, sql, sum } from "drizzle-orm";
import { createHash } from "node:crypto";
import { documents, extractions, rateLimits } from "@/db/schema";
import type { Database } from "@/db/types";
import { costUsd, PRICES_PER_MTOK } from "@/lib/pricing";

/**
 * Cost control for the public demo, which spends the owner's API key: daily caps
 * on uploads and on model spend across the whole demo, and rate limits per IP
 * and per API key. Samples and visitors' copies of them make no model calls,
 * so they count toward none of these.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Uploads accepted per rolling 24 hours across the whole demo, from the browser and the API together. */
export const DAILY_UPLOAD_LIMIT = Number(process.env.DOCWISE_DAILY_UPLOADS || 50);

/** Estimated model spend per rolling 24 hours, in US dollars, from the logged tokens. */
export const DAILY_BUDGET_USD = Number(process.env.DOCWISE_DAILY_BUDGET_USD || 2);

export type RateLimit = { name: string; max: number; windowMs: number };

export const RATE_LIMITS = {
  uploadsPerIp: { name: "upload-ip", max: 10, windowMs: 60 * 60 * 1000 },
  copiesPerIp: { name: "copy-ip", max: 30, windowMs: 60 * 60 * 1000 },
  keysPerIp: { name: "key-ip", max: 10, windowMs: DAY_MS },
  requestsPerKey: { name: "api-key", max: 60, windowMs: 60 * 1000 },
} satisfies Record<string, RateLimit>;

export type HitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Counts one use of `limit` by `subject` in the current fixed window. One
 * upsert, so concurrent requests can't both slip under the limit.
 */
export async function hit(db: Database, limit: RateLimit, subject: string, now = new Date()): Promise<HitResult> {
  const start = Math.floor(now.getTime() / limit.windowMs) * limit.windowMs;
  const bucket = `${limit.name}:${subject}`;
  const windowStart = new Date(start);
  const [row] = await db
    .insert(rateLimits)
    .values({ bucket, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.bucket, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  // Earlier windows of this bucket are no longer needed, and now and then every
  // expired row goes (subjects that never come back would otherwise stay).
  await db.delete(rateLimits).where(and(eq(rateLimits.bucket, bucket), lt(rateLimits.windowStart, windowStart)));
  if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * DAY_MS)));
  if (row.count <= limit.max) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((start + limit.windowMs - now.getTime()) / 1000)) };
}

/** A stable, non-reversible subject for an IP address (raw addresses aren't stored). */
export function ipSubject(ip: string | null): string {
  return createHash("sha256").update(ip || "unknown").digest("base64url").slice(0, 22);
}

/** The client's IP from the platform's forwarding headers (Vercel sets `x-forwarded-for`). */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || null;
}

// A model without a listed price is counted at the most expensive listed one.
const MAX_PRICE = Object.values(PRICES_PER_MTOK).reduce((a, b) => (a.input + a.output >= b.input + b.output ? a : b));

/** Uploads (browser and API) in the last 24 hours. */
export async function uploadsToday(db: Database, now = new Date()): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.source, "upload"), isNull(documents.copiedFrom), gt(documents.createdAt, new Date(now.getTime() - DAY_MS))));
  return n;
}

/** Estimated model spend in the last 24 hours, in US dollars, from the extraction log. */
export async function spentToday(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .select({ model: extractions.model, tokensIn: sum(extractions.tokensIn), tokensOut: sum(extractions.tokensOut) })
    .from(extractions)
    .innerJoin(documents, eq(documents.id, extractions.documentId))
    .where(and(eq(documents.source, "upload"), isNull(documents.copiedFrom), gt(extractions.createdAt, new Date(now.getTime() - DAY_MS))))
    .groupBy(extractions.model);
  return rows.reduce((total, row) => {
    const [tokensIn, tokensOut] = [Number(row.tokensIn ?? 0), Number(row.tokensOut ?? 0)];
    return total + (costUsd(row.model, tokensIn, tokensOut) ?? (tokensIn * MAX_PRICE.input + tokensOut * MAX_PRICE.output) / 1_000_000);
  }, 0);
}

export type CapOptions = { dailyLimit?: number; budgetUsd?: number; now?: Date };

/**
 * Why the demo can't start another model run right now, or null if it can.
 * A new upload is checked against both daily caps; a retry only against the budget.
 */
export async function capReached(db: Database, kind: "upload" | "retry", { dailyLimit = DAILY_UPLOAD_LIMIT, budgetUsd = DAILY_BUDGET_USD, now = new Date() }: CapOptions = {}): Promise<string | null> {
  if (kind === "upload" && (await uploadsToday(db, now)) >= dailyLimit) {
    return `The demo has reached today's limit of ${dailyLimit} uploads. Try a sample invoice, or come back tomorrow.`;
  }
  if ((await spentToday(db, now)) >= budgetUsd) return "The demo has used today's budget for the model. Try a sample invoice, or come back tomorrow.";
  return null;
}
