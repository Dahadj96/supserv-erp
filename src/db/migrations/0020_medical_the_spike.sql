ALTER TABLE "deal" ADD COLUMN "datasheet_requirement" text DEFAULT 'not_stated' NOT NULL;
--> statement-breakpoint
-- Three answers and no fourth. A typo that silently became a fourth value
-- would block nothing, and "the annex was incomplete and it let the offer go
-- out" is not a bug anybody would find until a tender was discarded.
ALTER TABLE "deal" ADD CONSTRAINT "deal_known_datasheet_requirement"
  CHECK ("datasheet_requirement" IN ('required','kept_anyway','not_stated'));--> statement-breakpoint

-- `item_coverage.deal_id` has always been a bare uuid. It is a deal.
ALTER TABLE "item_coverage" ADD CONSTRAINT "item_coverage_deal_id_deal_id_fk"
  FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- "Not applicable" is a real answer AND it must carry its reason. Screen 78:
-- "Marked once, with a reason, and it counts as complete." Without the reason
-- it is indistinguishable from somebody clicking to make a red row go away.
ALTER TABLE "item_coverage" ADD CONSTRAINT "item_coverage_not_applicable_has_a_reason"
  CHECK ("status" <> 'not_applicable' OR "not_applicable_reason" IS NOT NULL);--> statement-breakpoint

-- Screen 78 reads every file for every item on a deal, on every load.
CREATE INDEX "item_media_item" ON "item_media" USING btree ("item_id");
