ALTER TABLE "document_line" ADD COLUMN "unit_cost" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "cost_quote_id" uuid;