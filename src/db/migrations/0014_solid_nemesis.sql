CREATE TABLE "document_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"wording" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"footer_mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "render_snapshot" jsonb;