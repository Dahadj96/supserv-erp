CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"object" text NOT NULL,
	"contract_ref" text,
	"wilaya" text,
	"amount_excl" numeric(16, 2),
	"currency" text DEFAULT 'DZD' NOT NULL,
	"started_on" date,
	"contractual_end" date,
	"physical_percent" integer,
	"physical_by" text,
	"physical_at" timestamp with time zone,
	"retention_pct" numeric(6, 3) DEFAULT '0' NOT NULL,
	"warranty_months" integer,
	"pv_provisoire_on" date,
	"pv_provisoire_planned" date,
	"pv_definitive_on" date,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"delete_reason" text,
	CONSTRAINT "project_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "project_caution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pct" numeric(6, 3),
	"amount" numeric(16, 2),
	"currency" text DEFAULT 'DZD' NOT NULL,
	"bank_name" text,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"released_on" date,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_crew" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text,
	"proposed_at" timestamp with time zone,
	"on_site_since" date,
	"left_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "situation_detail" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"period_from" date,
	"period_to" date,
	"work_done" text,
	"submitted_on" date,
	"approved_on" date,
	"approved_by" text
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_caution" ADD CONSTRAINT "project_caution_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_crew" ADD CONSTRAINT "project_crew_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_crew" ADD CONSTRAINT "project_crew_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "situation_detail" ADD CONSTRAINT "situation_detail_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "situation_detail" ADD CONSTRAINT "situation_detail_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;