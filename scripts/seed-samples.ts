/**
 * Loads the public demo's sample invoices into the database and storage the
 * environment points at (DATABASE_URL, R2_* or STORAGE_DRIVER=local), from the
 * test set and the saved answers of SAMPLE_RUN. No model calls.
 *
 *   npm run seed:samples              # adds missing samples, keeps existing ones
 *   npm run seed:samples -- --replace # re-creates every sample
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { SAMPLE_RUN } from "../src/lib/samples";
import { seedSamples } from "../src/server/seed";
import { getStorage } from "../src/server/storage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  const { added, kept } = await seedSamples(db, getStorage(), {
    testSet: path.join(process.cwd(), "test-set"),
    responses: path.join(process.cwd(), "docs", "measurements", "responses", SAMPLE_RUN),
    replace: process.argv.includes("--replace"),
  });
  console.log(`Samples added: ${added.join(", ") || "none"}; kept: ${kept.join(", ") || "none"}`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
