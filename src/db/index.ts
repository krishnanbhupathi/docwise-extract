import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare: false — Neon's pooled endpoint (PgBouncer, transaction mode)
  // does not support named prepared statements.
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema, casing: "snake_case" });
}

type Db = ReturnType<typeof createDb>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;
