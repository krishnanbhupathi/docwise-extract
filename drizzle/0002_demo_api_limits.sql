CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "prefix" text NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "copied_from" text;--> statement-breakpoint
CREATE INDEX "api_keys_workspace_id_index" ON "api_keys" USING btree ("workspace_id");