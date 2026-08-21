CREATE TABLE "extraction_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"display" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"caveat" text,
	"citation_page" integer NOT NULL,
	"citation_quote" text NOT NULL,
	"citation_article" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confirmed_value" text,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intake_dossier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"attachment_id" uuid,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"provider" text,
	"locale" text,
	"pages" integer DEFAULT 0 NOT NULL,
	"unread_pages" jsonb,
	"status" text DEFAULT 'reading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_page" (
	"dossier_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "intake_page_dossier_id_page_pk" PRIMARY KEY("dossier_id","page")
);
--> statement-breakpoint
ALTER TABLE "extraction_field" ADD CONSTRAINT "extraction_field_dossier_id_intake_dossier_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."intake_dossier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_dossier" ADD CONSTRAINT "intake_dossier_message_id_intake_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."intake_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_dossier" ADD CONSTRAINT "intake_dossier_attachment_id_intake_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."intake_attachment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_page" ADD CONSTRAINT "intake_page_dossier_id_intake_dossier_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."intake_dossier"("id") ON DELETE cascade ON UPDATE no action;