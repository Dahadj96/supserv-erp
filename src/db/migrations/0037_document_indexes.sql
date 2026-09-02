CREATE INDEX "audit_entry_entity_idx" ON "audit_entry" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_kind_number_once" ON "document" USING btree ("kind","number") WHERE "document"."number" is not null and "document"."kind" not in ('client_order', 'supplier_invoice');--> statement-breakpoint
CREATE INDEX "document_party_idx" ON "document" USING btree ("party_id","kind");--> statement-breakpoint
CREATE INDEX "document_kind_status_idx" ON "document" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "document_line_document_idx" ON "document_line" USING btree ("document_id","position");