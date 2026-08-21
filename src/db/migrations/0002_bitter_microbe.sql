ALTER TABLE "notification_pref" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "saved_view" ALTER COLUMN "owner_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "saved_view" ALTER COLUMN "is_default_for" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "table_preference" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_preference" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_preference" ALTER COLUMN "cover_user_id" SET DATA TYPE text;