CREATE TABLE "sourcing_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"deal_line_id" uuid NOT NULL,
	"unit_price" numeric(16, 4),
	"their_designation" text,
	"their_reference" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sourcing_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"deal_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone,
	"reply_by" timestamp with time zone,
	"excluded_line_ids" text[],
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourcing_request_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "sourcing_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"person_id" uuid,
	"sent_to" text,
	"status" text DEFAULT 'asked' NOT NULL,
	"received_at" timestamp with time zone,
	"validity_days" integer,
	"lead_time_days" integer,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"is_excl_vat" boolean DEFAULT true NOT NULL,
	"note" text,
	"chased_count" integer DEFAULT 0 NOT NULL,
	"last_chased_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "required_validity_days" integer;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "required_delivery_days" integer;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "late_penalty" text;--> statement-breakpoint
ALTER TABLE "sourcing_line" ADD CONSTRAINT "sourcing_line_response_id_sourcing_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."sourcing_response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_line" ADD CONSTRAINT "sourcing_line_deal_line_id_deal_line_id_fk" FOREIGN KEY ("deal_line_id") REFERENCES "public"."deal_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_request" ADD CONSTRAINT "sourcing_request_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_response" ADD CONSTRAINT "sourcing_response_request_id_sourcing_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sourcing_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_response" ADD CONSTRAINT "sourcing_response_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_response" ADD CONSTRAINT "sourcing_response_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_line_one_per_line" ON "sourcing_line" USING btree ("response_id","deal_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_response_one_per_supplier" ON "sourcing_response" USING btree ("request_id","party_id");
--> statement-breakpoint
-- A response's status is a small closed list, and `bounced` has to stay
-- distinct from `no_reply` for the reply-rate card to mean anything. A typo
-- that silently becomes a sixth status would make a supplier vanish from every
-- count without anybody noticing.
ALTER TABLE "sourcing_response" ADD CONSTRAINT "sourcing_response_known_status"
  CHECK ("status" IN ('asked','quoted','declined','no_reply','bounced'));--> statement-breakpoint

-- A supplier who has not replied has nothing to say about validity or lead
-- time. Storing numbers against them would make `conflictsOf` raise conflicts
-- against an answer nobody gave.
ALTER TABLE "sourcing_response" ADD CONSTRAINT "sourcing_response_only_quotes_have_terms"
  CHECK ("status" = 'quoted' OR ("validity_days" IS NULL AND "lead_time_days" IS NULL));--> statement-breakpoint

-- Screen 05's derived stage counts sourcing requests per deal on every page
-- load of the list, and screen 67 reads responses per request.
CREATE INDEX "sourcing_request_deal" ON "sourcing_request" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "sourcing_response_request" ON "sourcing_response" USING btree ("request_id");
