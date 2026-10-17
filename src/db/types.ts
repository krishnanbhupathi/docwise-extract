import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Any Drizzle Postgres database with our schema: postgres.js in the app,
 * PGlite in tests. Data functions take it as a parameter so they can be
 * tested against a real Postgres without mocking.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
