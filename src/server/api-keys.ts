import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { apiKeys } from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * API keys, created from a browser and acting for that browser's workspace:
 * invoices sent through the API show up in its inbox and review queue. Only
 * a SHA-256 hash of each key is stored; the key itself is shown once.
 */

export const MAX_KEYS_PER_WORKSPACE = 3;

const FORMAT = /^dw_[A-Za-z0-9_-]{32}$/;

/** A high-entropy random key needs no salt or slow hash: SHA-256 can't be reversed or brute-forced. */
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export type CreateKeyResult = { ok: true; key: string } | { ok: false; error: string };

export async function createApiKey(db: Database, { workspaceId, label }: { workspaceId: string; label: string }): Promise<CreateKeyResult> {
  const [{ n }] = await db.select({ n: count() }).from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId));
  if (n >= MAX_KEYS_PER_WORKSPACE) return { ok: false, error: `This browser already has ${MAX_KEYS_PER_WORKSPACE} API keys. Revoke one to create another.` };
  const key = `dw_${randomBytes(24).toString("base64url")}`;
  await db.insert(apiKeys).values({ hash: hashKey(key), prefix: key.slice(0, 10), label: label.trim().slice(0, 60) || "API key", workspaceId });
  return { ok: true, key };
}

export async function listApiKeys(db: Database, workspaceId: string) {
  return db
    .select({ id: apiKeys.id, prefix: apiKeys.prefix, label: apiKeys.label, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: Database, { workspaceId, id }: { workspaceId: string; id: string }): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const deleted = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
    .returning({ id: apiKeys.id });
  return deleted.length > 0;
}

export type ApiCaller = { keyId: string; workspaceId: string };

/** The caller behind an `Authorization: Bearer dw_…` header, or null. */
export async function authenticate(db: Database, authorization: string | null, now = new Date()): Promise<ApiCaller | null> {
  const key = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!key || !FORMAT.test(key)) return null;
  const [row] = await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.hash, hashKey(key))).returning({ id: apiKeys.id, workspaceId: apiKeys.workspaceId });
  return row ? { keyId: row.id, workspaceId: row.workspaceId } : null;
}
