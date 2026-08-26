CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"party_id" uuid NOT NULL,
	"contact_person_id" uuid,
	"subject" text NOT NULL,
	"client_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"submission_method" text DEFAULT 'unknown' NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"owner_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"intake_message_id" uuid,
	"decision" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"expected_value" numeric(16, 2),
	"client_instructions" text,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "deal_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "deal_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"reference" text,
	"designation" text NOT NULL,
	"qty" numeric(16, 3) DEFAULT '1' NOT NULL,
	"unit" text,
	"item_id" uuid,
	"matched_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"deal_line_id" uuid,
	"deal_id" uuid,
	"source" text NOT NULL,
	"party_id" uuid,
	"price" numeric(16, 4) NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"is_excl_vat" boolean DEFAULT true NOT NULL,
	"is_verbal" boolean DEFAULT false NOT NULL,
	"evidence_file_id" uuid,
	"captured_by" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_place" text,
	"captured_from" text,
	"valid_until" date
);
--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_person_id_person_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_line" ADD CONSTRAINT "deal_line_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_line" ADD CONSTRAINT "deal_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_deal_line_id_deal_line_id_fk" FOREIGN KEY ("deal_line_id") REFERENCES "public"."deal_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_line_position" ON "deal_line" USING btree ("deal_id","position");
--> statement-breakpoint
-- A price is always FOR something. The schema comment says so; this makes it
-- true. Without it a row with three nulls is a number nobody can ever use and
-- nobody can ever find to delete.
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_has_a_subject"
  CHECK ("item_id" IS NOT NULL OR "deal_line_id" IS NOT NULL);--> statement-breakpoint

-- A verbal price has no evidence file, by definition. If it had one it would
-- not be verbal — that is the whole distinction screens 74 and 86 draw, and
-- the offer's "unconfirmed" label depends on it meaning something.
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_verbal_has_no_evidence"
  CHECK (NOT ("is_verbal" AND "evidence_file_id" IS NOT NULL));--> statement-breakpoint

-- No-bid is a decision with a reason. Screen 06: "recorded so we can learn from
-- it" — a no-bid with no reason teaches nobody anything, and six months later
-- nobody remembers whether it was the deadline or the payment terms.
ALTER TABLE "deal" ADD CONSTRAINT "deal_no_bid_has_a_reason"
  CHECK ("decision" IS DISTINCT FROM 'no_bid' OR "decision_reason" IS NOT NULL);
