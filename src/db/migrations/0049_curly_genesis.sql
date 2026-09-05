ALTER TABLE "saved_view" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "saved_view" CASCADE;--> statement-breakpoint
ALTER TABLE "delivery_detail" DROP CONSTRAINT "delivery_detail_site_contact_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_detail" DROP COLUMN "departs_at";--> statement-breakpoint
ALTER TABLE "delivery_detail" DROP COLUMN "site_contact_id";--> statement-breakpoint
ALTER TABLE "numbering_series" DROP COLUMN "reserve_on";--> statement-breakpoint
ALTER TABLE "import_batch" DROP COLUMN "source_kind";--> statement-breakpoint
ALTER TABLE "intake_attachment" DROP COLUMN "sha256";--> statement-breakpoint
ALTER TABLE "payment" DROP COLUMN "bank_account_id";--> statement-breakpoint
ALTER TABLE "party" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "tender_piece" DROP COLUMN "provided_at";