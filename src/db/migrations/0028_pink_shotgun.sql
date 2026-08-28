CREATE TABLE "assistant_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"citations" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_entity" text,
	"applied_entity_id" text
);
