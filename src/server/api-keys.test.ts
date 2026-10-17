import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiKeys } from "@/db/schema";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { MAX_KEYS_PER_WORKSPACE, authenticate, createApiKey, hashKey, listApiKeys, revokeApiKey } from "./api-keys";

let db: TestDb;
let close: () => Promise<void>;
beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = () => test.client.close();
});
afterAll(() => close());
beforeEach(() => resetTestDb(db));

async function newKey(workspaceId = "ws-1", label = "CI") {
  const result = await createApiKey(db, { workspaceId, label });
  if (!result.ok) throw new Error(result.error);
  return result.key;
}

describe("API keys", () => {
  it("are shown once and stored only as a hash", async () => {
    const key = await newKey();
    expect(key).toMatch(/^dw_[A-Za-z0-9_-]{32}$/);
    const [row] = await db.select().from(apiKeys);
    expect(row).toMatchObject({ hash: hashKey(key), prefix: key.slice(0, 10), label: "CI", workspaceId: "ws-1", lastUsedAt: null });
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it("authenticate the browser workspace that created them, and record their use", async () => {
    const key = await newKey();
    const now = new Date("2026-10-18T09:00:00Z");
    expect(await authenticate(db, `Bearer ${key}`, now)).toMatchObject({ workspaceId: "ws-1" });
    expect((await listApiKeys(db, "ws-1"))[0].lastUsedAt).toEqual(now);
    for (const header of [null, key, `Bearer ${key}x`, `Bearer dw_${"a".repeat(32)}`, "Basic abc"]) {
      expect(await authenticate(db, header)).toBeNull();
    }
  });

  it("are limited per browser and can be revoked only by that browser", async () => {
    for (let i = 0; i < MAX_KEYS_PER_WORKSPACE; i++) await newKey();
    expect(await createApiKey(db, { workspaceId: "ws-1", label: "" })).toMatchObject({ ok: false });
    const [first] = await listApiKeys(db, "ws-1");
    expect(await revokeApiKey(db, { workspaceId: "ws-2", id: first.id })).toBe(false);
    expect(await revokeApiKey(db, { workspaceId: "ws-1", id: "not-a-uuid" })).toBe(false);
    expect(await revokeApiKey(db, { workspaceId: "ws-1", id: first.id })).toBe(true);
    expect(await listApiKeys(db, "ws-1")).toHaveLength(MAX_KEYS_PER_WORKSPACE - 1);
    expect((await createApiKey(db, { workspaceId: "ws-1", label: "  " })).ok).toBe(true);
  });
});
