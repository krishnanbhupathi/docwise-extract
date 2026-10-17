CREATE TYPE "public"."approval" AS ENUM('auto', 'review');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "has_text" boolean;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "approval" "approval";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "confidence_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;