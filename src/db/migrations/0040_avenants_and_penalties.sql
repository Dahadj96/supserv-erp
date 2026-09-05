CREATE TABLE "amendment_detail" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"new_contractual_end" date,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "penalty_per_mille" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "penalty_cap_pct" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "amendment_detail" ADD CONSTRAINT "amendment_detail_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amendment_detail" ADD CONSTRAINT "amendment_detail_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;