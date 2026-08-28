CREATE TABLE "email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"scope" text DEFAULT 'template' NOT NULL,
	"subject" text,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_key_locale" ON "email_template" USING btree ("key","locale");