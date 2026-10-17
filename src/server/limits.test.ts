import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documents, extractions } from "@/db/schema";
import { createTestDb, resetTestDb, type TestDb } from "@/test/db";
import { capReached, clientIp, hit, ipSubject, spentToday, uploadsToday } from "./limits";

let db: TestDb;
let close: () => Promise<void>;
beforeAll(async () => {
  const test = await createTestDb();
  db = test.db;
  close = () => test.client.close();
});
afterAll(() => close());
beforeEach(() => resetTestDb(db));

const HOUR = 60 * 60 * 1000;

async function document(id: string, patch: Partial<typeof documents.$inferInsert> = {}) {
  await db.insert(documents).values({ id, workspaceId: "ws-1", fileKey: `uploads/${id}/a.pdf`, fileName: "a.pdf", mediaType: "application/pdf", sizeBytes: 100, ...patch });
}

async function extraction(documentId: string, model: string, tokensIn: number, tokensOut: number, createdAt = new Date()) {
  await db.insert(extractions).values({ documentId, attempt: 1, model, promptVersion: "v1", tokensIn, tokensOut, ms: 1000, createdAt });
}

describe("hit", () => {
  it("allows up to the limit per window, then says when to retry", async () => {
    const limit = { name: "test", max: 2, windowMs: HOUR };
    const now = new Date("2026-10-18T10:15:00Z");
    expect(await hit(db, limit, "a", now)).toEqual({ ok: true });
    expect(await hit(db, limit, "a", now)).toEqual({ ok: true });
    expect(await hit(db, limit, "a", now)).toEqual({ ok: false, retryAfterSeconds: 45 * 60 });
    // Another subject has its own count; the next window starts again.
    expect(await hit(db, limit, "b", now)).toEqual({ ok: true });
    expect(await hit(db, limit, "a", new Date("2026-10-18T11:00:00Z"))).toEqual({ ok: true });
  });

  it("counts concurrent hits exactly", async () => {
    const limit = { name: "burst", max: 5, windowMs: HOUR };
    const results = await Promise.all(Array.from({ length: 8 }, () => hit(db, limit, "a")));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});

describe("client IP", () => {
  it("takes the first forwarded address and never stores it raw", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBeNull();
    expect(ipSubject("203.0.113.7")).not.toContain("203");
    expect(ipSubject("203.0.113.7")).toBe(ipSubject("203.0.113.7"));
  });
});

describe("daily caps", () => {
  it("counts uploads and their spend, but not samples or visitors' copies of them", async () => {
    await document("up1");
    await document("sample", { source: "demo", workspaceId: null });
    await document("copy", { copiedFrom: "sample" });
    await extraction("up1", "claude-sonnet-5-5", 4000, 500); // $0.008 + $0.005
    await extraction("sample", "claude-sonnet-5-5", 4000, 500);
    await extraction("copy", "claude-sonnet-5-5", 4000, 500);
    expect(await uploadsToday(db)).toBe(1);
    expect(await spentToday(db)).toBeCloseTo(0.013);
  });

  it("forgets spend older than 24 hours and prices an unknown model at the dearest listed price", async () => {
    await document("up1");
    await extraction("up1", "claude-sonnet-5-5", 1_000_000, 0, new Date(Date.now() - 25 * HOUR));
    await extraction("up1", "some-fallback-model", 1_000_000, 0);
    expect(await spentToday(db)).toBeCloseTo(4);
  });

  it("closes new uploads at either cap, and retries only at the budget", async () => {
    await document("up1");
    await extraction("up1", "claude-sonnet-5-5", 100_000, 0); // $0.20
    expect(await capReached(db, "upload", { dailyLimit: 2, budgetUsd: 1 })).toBeNull();
    expect(await capReached(db, "upload", { dailyLimit: 1, budgetUsd: 1 })).toMatch(/limit of 1 uploads/);
    expect(await capReached(db, "retry", { dailyLimit: 1, budgetUsd: 1 })).toBeNull();
    expect(await capReached(db, "retry", { dailyLimit: 1, budgetUsd: 0.2 })).toMatch(/today's budget/);
  });
});
