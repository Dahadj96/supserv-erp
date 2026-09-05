ALTER TABLE "item_media" ADD COLUMN "storage_path" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_media" ADD COLUMN "filename" text NOT NULL;--> statement-breakpoint
ALTER TABLE "item_media" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "item_media" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "item_media" ADD COLUMN "added_by" text;--> statement-breakpoint
ALTER TABLE "item_media" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;