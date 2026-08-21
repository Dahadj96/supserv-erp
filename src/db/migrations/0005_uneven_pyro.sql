ALTER TABLE "person" ADD COLUMN "prefers" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "last_contact_at" timestamp with time zone;