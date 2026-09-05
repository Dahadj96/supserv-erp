ALTER TABLE "person_certification" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "person_certification" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_certification" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "person_certification" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;