CREATE TABLE "bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_name" text NOT NULL,
	"agency" text,
	"rib" text NOT NULL,
	"iban" text,
	"swift" text,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"legal_form" text,
	"capital" numeric(16, 2),
	"rc" text,
	"nif" text,
	"nis" text,
	"ai" text,
	"address" text,
	"wilaya" text,
	"phone" text,
	"email" text,
	"website" text,
	"logo_path" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "vat_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"authority" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
