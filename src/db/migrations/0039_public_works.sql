ALTER TABLE "project" ADD COLUMN "contract_document_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "retention_base" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_contract_document_id_document_id_fk" FOREIGN KEY ("contract_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;