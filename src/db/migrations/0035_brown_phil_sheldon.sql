ALTER TABLE "price_quote" ADD COLUMN "designation" text;--> statement-breakpoint

-- What the price was FOR, in words, so the row keeps a subject after its line
-- has gone. Backfilled from the line each existing quote still points at.
UPDATE "price_quote" q
   SET "designation" = l."designation"
  FROM "deal_line" l
 WHERE q."deal_line_id" = l."id"
   AND q."designation" IS NULL;--> statement-breakpoint

-- Then from the catalogue, for the ones gathered against an article rather
-- than against an enquiry line.
UPDATE "price_quote" q
   SET "designation" = i."designation"
  FROM "item" i
 WHERE q."item_id" = i."id"
   AND q."designation" IS NULL;--> statement-breakpoint

-- THE SUBJECT OF A PRICE, WIDENED.
--
-- Migration 0015 required `item_id` or `deal_line_id`, which was right and was
-- not enough. `deal_line_id` is `ON DELETE SET NULL`, so screen 06 correcting a
-- pasted line — the ordinary case, several times a week — tried to write a row
-- with neither and the whole correction was refused. The price it was
-- protecting was a shop-counter price for an article nobody had matched to the
-- catalogue, which screen 86 calls normal rather than an error.
--
-- So a price may now also be for a DESIGNATION: "21 400 DZD, vanne papillon
-- DN80, Ets Chergui, 4 November" is evidence and is findable. The words alone
-- are the subject — not the words plus the enquiry — because `deal_id` is
-- `ON DELETE SET NULL` too, and a quote that survived its line only to be
-- refused when the enquiry is deleted has the same bug one level up. That is
-- the case the schema note beside `deal_id` already describes: the price
-- survives its enquiry and becomes a catalogue price.
--
-- What is still refused is the row 0015 was written for — a number with no
-- subject at all, which nobody can use and nobody can find to delete.
ALTER TABLE "price_quote" DROP CONSTRAINT "price_quote_has_a_subject";--> statement-breakpoint

ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_has_a_subject"
  CHECK (
    "item_id" IS NOT NULL
    OR "deal_line_id" IS NOT NULL
    OR "designation" IS NOT NULL
  );
