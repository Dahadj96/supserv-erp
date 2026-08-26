CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"received_on" date NOT NULL,
	"bank_ref" text,
	"bank_account_id" uuid,
	"note" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"step_key" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"reply" text,
	"replied_at" timestamp with time zone,
	"promised_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relance_step" (
	"key" text PRIMARY KEY NOT NULL,
	"after_due_days" integer NOT NULL,
	"channel" text NOT NULL,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relance" ADD CONSTRAINT "relance_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocation_once" ON "payment_allocation" USING btree ("payment_id","document_id");
--> statement-breakpoint
-- A payment is money that arrived. Zero or negative is not a payment; a refund
-- is its own thing and does not exist yet, so this refuses rather than letting
-- somebody encode one as a negative receipt nobody will find later.
ALTER TABLE "payment" ADD CONSTRAINT "payment_is_positive" CHECK ("amount" > 0);--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_is_positive"
  CHECK ("amount" > 0);--> statement-breakpoint

-- THE ONE THAT MATTERS. A payment may be allocated across several invoices,
-- and the parts may sum to LESS than the payment (the remainder is money held
-- and not yet assigned). They may never sum to MORE: allocating 600 000 of a
-- 500 000 transfer makes two invoices look settled with money that never
-- arrived, and the bank statement will not say which.
--
-- A trigger rather than a CHECK, because the rule spans rows.
CREATE OR REPLACE FUNCTION allocation_within_payment() RETURNS trigger AS $$
DECLARE allocated numeric; received numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO allocated
    FROM payment_allocation WHERE payment_id = new.payment_id;
  SELECT amount INTO received FROM payment WHERE id = new.payment_id;
  IF allocated > received THEN
    RAISE EXCEPTION 'allocated % exceeds the payment of %', allocated, received
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER payment_allocation_within_payment
  AFTER INSERT OR UPDATE ON payment_allocation
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION allocation_within_payment();--> statement-breakpoint

ALTER TABLE "relance" ADD CONSTRAINT "relance_known_status"
  CHECK ("status" IN ('draft','sent','delivered','replied','failed'));--> statement-breakpoint

-- Screen 20 reads every unpaid invoice and every chase against it, on load.
CREATE INDEX "payment_allocation_document" ON "payment_allocation" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "relance_document" ON "relance" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "payment_party" ON "payment" USING btree ("party_id");
