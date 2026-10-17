import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

/**
 * A fresh in-process Postgres (PGlite) with every migration applied.
 * Tests run against the real constraints and foreign keys with no database
 * server, so CI needs nothing but Node.
 */
export async function createTestDb() {
  const client = new PGlite();
  const dir = path.join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    for (const statement of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

/** Empties every table (one database per test file, reset between tests: much faster than re-migrating). */
export async function resetTestDb(db: TestDb) {
  // documents cascades to extractions → fields / line_items.
  await db.execute(sql`TRUNCATE documents, api_keys, eval_runs, rate_limits CASCADE`);
}
