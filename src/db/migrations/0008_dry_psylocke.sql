ALTER TABLE "intake_message" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_message" ADD COLUMN "deadline_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_message" ADD COLUMN "read_at" timestamp with time zone;