import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** `uploading`: the row exists, the file isn't confirmed yet. Then queued → extracting → needs_review / approved, or failed. */
export const documentStatus = pgEnum("document_status", ["uploading", "queued", "extracting", "needs_review", "approved", "failed"]);
export const documentSource = pgEnum("document_source", ["upload", "demo"]);

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
    error: text(),
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
    /** high | low; set from Day 2 (rules + the model's own uncertainty). */
    confidence: text(),
    ruleFailures: jsonb().$type<string[]>().notNull().default([]),
    /** The model's reason when it listed this field as uncertain. */
    modelUncertain: text(),
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

/** Only a hash of each key is stored. */
export const apiKeys = pgTable("api_keys", {
  id: uuid().primaryKey().defaultRandom(),
  hash: text().notNull().unique(),
  label: text().notNull(),
  createdAt: createdAt(),
});

export const evalRuns = pgTable("eval_runs", {
  id: uuid().primaryKey().defaultRandom(),
  promptVersion: text().notNull(),
  model: text().notNull(),
  split: text().notNull(),
  metricsJson: jsonb().notNull(),
  createdAt: createdAt(),
});
