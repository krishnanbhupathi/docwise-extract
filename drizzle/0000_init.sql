CREATE TYPE "public"."document_source" AS ENUM('upload', 'demo');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploading', 'queued', 'extracting', 'needs_review', 'approved', 'failed');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"pages" integer,
	"status" "document_status" DEFAULT 'uploading' NOT NULL,
	"source" "document_source" DEFAULT 'upload' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"split" text NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"effort" text,
	"raw_json" jsonb,
	"stop_reason" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"ms" integer NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"extraction_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text,
	"confidence" text,
	"rule_failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_uncertain" text,
	"corrected_value" text,
	"corrected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"extraction_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric,
	"unit_price" numeric,
	"amount" numeric NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_workspace_id_created_at_index" ON "documents" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_status_updated_at_index" ON "documents" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "extractions_document_id_index" ON "extractions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "extractions_created_at_index" ON "extractions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_document_id_name_index" ON "fields" USING btree ("document_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "line_items_document_id_position_index" ON "line_items" USING btree ("document_id","position");