import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "../playwright.config";

/** A migrated, empty e2e database with the demo's samples. */
export default async function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, STORAGE_DRIVER: "local" };
  execFileSync("npm", ["run", "--silent", "db:migrate"], { env, stdio: "inherit" });
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql`TRUNCATE documents, api_keys, rate_limits CASCADE`;
  await sql.end();
  execFileSync("npm", ["run", "--silent", "seed:samples"], { env, stdio: "inherit" });
}
