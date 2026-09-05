ALTER TABLE "merge_log" ADD COLUMN "reverses" jsonb;--> statement-breakpoint
ALTER TABLE "merge_log" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merge_log" ADD COLUMN "reversed_by" text;