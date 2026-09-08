ALTER TABLE "document" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "delete_reason" text;