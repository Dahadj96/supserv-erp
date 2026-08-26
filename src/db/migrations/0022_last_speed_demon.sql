CREATE TABLE "delivery_detail" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"packages" integer,
	"gross_weight_kg" numeric(12, 3),
	"volume_m3" numeric(12, 3),
	"carrier" text,
	"vehicle" text,
	"driver" text,
	"departs_at" timestamp with time zone,
	"delivery_address" text,
	"site_contact_id" uuid,
	"site_contact_name" text,
	"received_by" text,
	"received_on" date,
	"signed_copy_on_file" timestamp with time zone,
	"signed_copy_by" text,
	"reserves" text
);
--> statement-breakpoint
ALTER TABLE "document_line" ADD COLUMN "source_line_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_detail" ADD CONSTRAINT "delivery_detail_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_detail" ADD CONSTRAINT "delivery_detail_site_contact_id_person_id_fk" FOREIGN KEY ("site_contact_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Hand-added. `source_line_id` is declared as a plain uuid in the schema file
-- because a self-reference inside one pgTable() definition cannot name itself,
-- but the constraint is the point: a BL line that points at a line which no
-- longer exists would make "already delivered 12" unanswerable.
--
-- ON DELETE SET NULL, not CASCADE. Only DRAFT lines can ever be deleted (an
-- issued document is immutable, LAW 5), and losing the link is the right
-- casualty — deleting the delivery note as well would destroy the proof that
-- something was actually delivered.
ALTER TABLE "document_line" ADD CONSTRAINT "document_line_source_line_id_fk"
  FOREIGN KEY ("source_line_id") REFERENCES "public"."document_line"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "document_line_source_line_idx" ON "document_line" ("source_line_id");
