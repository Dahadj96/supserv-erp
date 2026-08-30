CREATE TABLE "bpu_erratum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"filename" text,
	"received_on" date,
	"lines" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" text,
	"applied_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "bpu_mapping" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"mapping" jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "tender" ADD COLUMN "bpu_source" text;--> statement-breakpoint
ALTER TABLE "tender" ADD COLUMN "bpu_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bpu_erratum" ADD CONSTRAINT "bpu_erratum_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bpu_mapping" ADD CONSTRAINT "bpu_mapping_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;