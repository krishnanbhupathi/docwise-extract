import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** `uploading`: the row exists, the file isn't confirmed yet. Then queued → extracting → needs_review / approved, or failed. */
export const documentStatus = pgEnum("document_status", ["uploading", "queued", "extracting", "needs_review", "approved", "failed"]);
export const documentSource = pgEnum("document_source", ["upload", "demo"]);
/** How an approved document got approved: every field high (`auto`), or by a person (`review`). */
export const approval = pgEnum("approval", ["auto", "review"]);

export const documents = pgTable(
  "documents",
  {
    id: text().primaryKey(),
    /** The anonymous browser that uploaded it; null for demo documents everyone sees. */
    workspaceId: text(),
    fileKey: text().notNull(),
    fileName: text().notNull(),
    mediaType: text().notNull(),
    sizeBytes: integer().notNull(),
    pages: integer(),
    status: documentStatus().notNull().default("uploading"),
    source: documentSource().notNull().default("upload"),
    /** The sample this is a visitor's private copy of (to try the review on). No model call, so it counts toward no cap; no foreign key, so a re-seeded sample can't turn copies into uploads. */
    copiedFrom: text(),
    /** A plain message for the visitor; details stay in `extractions.errors`. */
    error: text(),
    /** Extraction runs started (the first one plus retries); retries stop at a limit. */
    runs: integer().notNull().default(0),
    /** Whether the PDF had a text layer to check values against (null until extracted). */
    hasText: boolean(),
    approval: approval(),
    approvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt), index().on(t.status, t.updatedAt)],
);

/** One row per model call (a retry is a second row), so cost and time come straight from here. */
export const extractions = pgTable(
  "extractions",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: text()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    attempt: integer().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    effort: text(),
    /** The full API response; null if the call itself failed. */
    rawJson: jsonb(),
    stopReason: text(),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    ms: integer().notNull(),
    fallbackUsed: boolean().notNull().default(false),
    /** True only for the attempt whose output passed validation and was stored. */
    accepted: boolean().notNull().default(false),
    errors: jsonb().$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.documentId), index().on(t.createdAt)],
);

/** Header fields, plus one `line_items` row that carries the line items' rule failures and confidence. */
export const fields = pgTable(
  "fields",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: text()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extractionId: uuid()
      .notNull()
      .references(() => extractions.id, { onDelete: "cascade" }),
    name: text().notNull(),
    value: text(),
    /** high | low, from `lib/confidence.ts`; the reasons say why a field is low. */
    confidence: text(),
    confidenceReasons: jsonb().$type<string[]>().notNull().default([]),
    ruleFailures: jsonb().$type<string[]>().notNull().default([]),
    /** The model's reason when it listed this field as uncertain. */
    modelUncertain: text(),
    /**
     * A reviewer's value, set when it differs from the extracted one (null can be a
     * correction: `corrected_at` says whether there is one). For `line_items`, the
     * corrected list as JSON; the extracted lines stay in `line_items`.
     */
    correctedValue: text(),
    correctedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.documentId, t.name)],
);

export const lineItems = pgTable(
  "line_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    documentId: text()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extractionId: uuid()
      .notNull()
      .references(() => extractions.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    description: text().notNull(),
    // Unconstrained numeric keeps the scale as printed ("100.00" stays "100.00").
    quantity: numeric(),
    unitPrice: numeric(),
    amount: numeric().notNull(),
  },
  (t) => [uniqueIndex().on(t.documentId, t.position)],
);

/** Only a hash of each key is stored. A key acts for the browser workspace that created it. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    hash: text().notNull().unique(),
    /** The key's first characters, so a list can tell keys apart without showing them. */
    prefix: text().notNull(),
    label: text().notNull(),
    workspaceId: text().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId)],
);

/** Fixed-window counters for rate limits (per IP, per API key), so no extra service is needed. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] })],
);

export const evalRuns = pgTable("eval_runs", {
  id: uuid().primaryKey().defaultRandom(),
  promptVersion: text().notNull(),
  model: text().notNull(),
  split: text().notNull(),
  metricsJson: jsonb().notNull(),
  createdAt: createdAt(),
});
