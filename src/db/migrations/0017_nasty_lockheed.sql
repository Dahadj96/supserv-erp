ALTER TABLE "deal" ALTER COLUMN "owner_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deal" ALTER COLUMN "decided_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "deal" ALTER COLUMN "deleted_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "price_quote" ALTER COLUMN "captured_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "party" ALTER COLUMN "deleted_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "deleted_by" SET DATA TYPE text;