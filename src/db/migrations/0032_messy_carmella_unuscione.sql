CREATE TABLE "personnel_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"rejected_reason" text,
	"note" text,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "personnel_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"role" text NOT NULL,
	"project_id" uuid,
	"wilaya" text,
	"needed" integer DEFAULT 1 NOT NULL,
	"start_on" date,
	"certification_required" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"cancelled_reason" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personnel_request_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "applied_for" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "mobility" text;--> statement-breakpoint
ALTER TABLE "personnel_candidate" ADD CONSTRAINT "personnel_candidate_request_id_personnel_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."personnel_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_candidate" ADD CONSTRAINT "personnel_candidate_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_request" ADD CONSTRAINT "personnel_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_candidate_once" ON "personnel_candidate" USING btree ("request_id","person_id");