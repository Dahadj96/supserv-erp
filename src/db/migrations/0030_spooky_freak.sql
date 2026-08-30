CREATE TABLE "company_credential" (
	"key" text PRIMARY KEY NOT NULL,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"file_id" text,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"procedure" text NOT NULL,
	"submission_place" text,
	"opens_at" timestamp with time zone,
	"caution_amount" numeric(16, 2),
	"caution_pct" numeric(6, 3),
	"caution_requested_at" timestamp with time zone,
	"caution_received_at" timestamp with time zone,
	"offer_validity_days" integer,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"deposit_receipt_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_piece" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"section" text NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"credential_key" text,
	"file_id" text,
	"provided_at" timestamp with time zone,
	"note" text,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tender" ADD CONSTRAINT "tender_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_piece" ADD CONSTRAINT "tender_piece_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;