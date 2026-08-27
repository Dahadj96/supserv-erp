CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"happened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" date,
	"done_at" timestamp with time zone,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"delete_reason" text
);
--> statement-breakpoint
CREATE INDEX "note_about_idx" ON "note" USING btree ("entity","entity_id","happened_at");--> statement-breakpoint
CREATE INDEX "note_due_idx" ON "note" USING btree ("due_at");
--> statement-breakpoint
-- Hand-added. A note with no words is not a note.
--
-- The whole reason this table exists is the sentence in it: "they confirmed the
-- office accepts deposits from 08:00, bring two sealed envelopes". A row with
-- an empty body records that somebody opened the composer, which is not a fact
-- anybody needs six months later, and it would sit on the timeline looking like
-- something was said.
ALTER TABLE "note" ADD CONSTRAINT "note_body_not_empty"
  CHECK (length(btrim("body")) > 0);
