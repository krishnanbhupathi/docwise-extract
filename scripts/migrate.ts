import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  // Preview deployments have no database yet (they'd otherwise migrate production).
  if (process.env.VERCEL_ENV === "preview") {
    console.log("No DATABASE_URL in this preview deployment; skipping migrations");
    process.exit(0);
  }
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function main(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrations applied");
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
