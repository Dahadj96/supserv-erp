CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"sheet_name" text,
	"source_kind" text DEFAULT 'upload' NOT NULL,
	"becomes" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"status" text DEFAULT 'mapping' NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"problems" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone,
	"undoable_until" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_row" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;