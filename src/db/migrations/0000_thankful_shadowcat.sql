CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"series_id" uuid,
	"party_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"fx_rate" numeric(14, 6),
	"issued_on" date,
	"due_on" date,
	"valid_days" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"global_discount_pct" numeric(6, 3) DEFAULT '0',
	"advance_deducted" numeric(16, 2) DEFAULT '0',
	"retention_pct" numeric(6, 3) DEFAULT '0',
	"stamp_duty" numeric(16, 2) DEFAULT '0',
	"totals" jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"line_kind" text NOT NULL,
	"is_option" boolean DEFAULT false NOT NULL,
	"item_id" uuid,
	"reference" text,
	"designation" text,
	"note" text,
	"designation_source" text,
	"unit" text,
	"qty" numeric(16, 4),
	"unit_price" numeric(16, 4),
	"discount_pct" numeric(6, 3) DEFAULT '0',
	"vat_rate" numeric(5, 2),
	"vat_exempt_ref" text,
	"total_excl" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "document_link" (
	"from_document" uuid NOT NULL,
	"to_document" uuid NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "document_link_from_document_to_document_relation_pk" PRIMARY KEY("from_document","to_document","relation")
);
--> statement-breakpoint
CREATE TABLE "numbering_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"reset" text DEFAULT 'yearly' NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"reserve_on" text DEFAULT 'issue' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocking_rule" (
	"code" text PRIMARY KEY NOT NULL,
	"applies_to" text NOT NULL,
	"message_key" text NOT NULL,
	"authority" text,
	"confirmed_by" text,
	"confirmed_on" date,
	"fix_route" text
);
--> statement-breakpoint
CREATE TABLE "notification_pref" (
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"quiet_from" time,
	"quiet_to" time,
	"digest_at" time,
	CONSTRAINT "notification_pref_user_id_event_pk" PRIMARY KEY("user_id","event")
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"sort" jsonb,
	"columns" jsonb,
	"owner_id" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"is_default_for" uuid
);
--> statement-breakpoint
CREATE TABLE "table_preference" (
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"columns" jsonb,
	"sort" jsonb,
	"page_size" integer DEFAULT 25,
	CONSTRAINT "table_preference_user_id_entity_pk" PRIMARY KEY("user_id","entity")
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ui_locale" text DEFAULT 'fr' NOT NULL,
	"date_format" text DEFAULT 'dd/MM/yyyy',
	"number_format" text DEFAULT 'fr-DZ',
	"week_starts_on" integer DEFAULT 0,
	"time_zone" text DEFAULT 'Africa/Algiers',
	"landing_page" text DEFAULT 'today',
	"signature_fr" text,
	"signature_en" text,
	"away_until" date,
	"cover_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"designation" text NOT NULL,
	"brand" text,
	"model" text,
	"unit" text,
	"kind" text NOT NULL,
	"is_generic" boolean DEFAULT false NOT NULL,
	"superseded_by" uuid,
	CONSTRAINT "item_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "item_alias" (
	"item_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" text NOT NULL,
	"party_id" uuid,
	"prefer_on_offer" boolean DEFAULT false NOT NULL,
	CONSTRAINT "item_alias_item_id_alias_pk" PRIMARY KEY("item_id","alias")
);
--> statement-breakpoint
CREATE TABLE "item_coverage" (
	"deal_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"requirement" text NOT NULL,
	"status" text NOT NULL,
	"not_applicable_reason" text,
	CONSTRAINT "item_coverage_deal_id_item_id_pk" PRIMARY KEY("deal_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "item_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"media_kind" text NOT NULL,
	"provenance" text NOT NULL,
	"party_id" uuid,
	"captured_on" date,
	"captured_at_place" text,
	"deal_id" uuid,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"nif" text,
	"nis" text,
	"rc" text,
	"ai" text,
	"address" text,
	"wilaya" text,
	"country" text DEFAULT 'DZ' NOT NULL,
	"doc_locale" text DEFAULT 'fr' NOT NULL,
	"email_locale" text DEFAULT 'fr' NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"payment_terms" text,
	"superseded_by" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "party_alias" (
	"party_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" text,
	CONSTRAINT "party_alias_party_id_alias_pk" PRIMARY KEY("party_id","alias")
);
--> statement-breakpoint
CREATE TABLE "party_role" (
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "party_role_party_id_role_pk" PRIMARY KEY("party_id","role")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"trade" text NOT NULL,
	"phone" text,
	"national_id" text,
	"wilaya" text,
	"source" text NOT NULL,
	"relationship" text NOT NULL,
	"employer_party_id" uuid,
	"superseded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_certification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"issued_by" text,
	"issued_on" date,
	"expires_on" date,
	"is_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_series_id_numbering_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."numbering_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_from_document_document_id_fk" FOREIGN KEY ("from_document") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_to_document_document_id_fk" FOREIGN KEY ("to_document") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_alias" ADD CONSTRAINT "item_alias_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_alias" ADD CONSTRAINT "item_alias_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_coverage" ADD CONSTRAINT "item_coverage_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_media" ADD CONSTRAINT "item_media_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_media" ADD CONSTRAINT "item_media_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_alias" ADD CONSTRAINT "party_alias_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_role" ADD CONSTRAINT "party_role_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_employer_party_id_party_id_fk" FOREIGN KEY ("employer_party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certification" ADD CONSTRAINT "person_certification_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;