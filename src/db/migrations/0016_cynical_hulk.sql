ALTER TABLE "document" ADD COLUMN "deal_id" uuid;
--> statement-breakpoint
-- The reference is declared here rather than on the drizzle column so the
-- delete rule is written down explicitly: an enquiry going in the bin must
-- never take an issued invoice with it. `no action` means the delete fails
-- loudly instead — and screen 83's bin sets `deleted_at` rather than deleting,
-- so in practice it never comes up. It is here for the day somebody runs a
-- real DELETE by hand.
ALTER TABLE "document" ADD CONSTRAINT "document_deal_id_deal_id_fk"
  FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Screen 05's stage is `count(document) where deal_id = …` for every row on the
-- list. Without this index that is a sequential scan per page load.
CREATE INDEX "document_deal_id_kind" ON "document" USING btree ("deal_id","kind");
