CREATE TABLE "audit_entry" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"source_screen" text
);
--> statement-breakpoint
CREATE TABLE "duplicate_dismissal" (
	"entity" text NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "duplicate_dismissal_entity_a_id_b_id_pk" PRIMARY KEY("entity","a_id","b_id")
);
--> statement-breakpoint
CREATE TABLE "merge_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"kept_id" uuid NOT NULL,
	"retired_id" uuid NOT NULL,
	"field_choices" jsonb NOT NULL,
	"moved_counts" jsonb NOT NULL,
	"merged_by" text,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversible_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "email" text;