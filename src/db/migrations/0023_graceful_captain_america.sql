CREATE TABLE "approval_gate" (
	"code" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'gerant' NOT NULL,
	"threshold" integer,
	"requires_reason_code" boolean DEFAULT true NOT NULL,
	"requires_justification" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate_code" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"subject" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason_code" text,
	"justification" text,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"self_approved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_gate_code_approval_gate_code_fk" FOREIGN KEY ("gate_code") REFERENCES "public"."approval_gate"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "approval_request_waiting_idx"
  ON "approval_request" ("status", "requested_at");
--> statement-breakpoint
-- Hand-added. A decided request must say WHO decided it and WHEN.
--
-- Screen 65: "A decision is — timestamped and attributed." That is the entire
-- value of the gate in a company where one man is both the Gérant and the
-- Commercial: the second person is not the point, the attribution is. A row
-- reading `approved` with a null `decided_by` is a gate that recorded nothing,
-- and it would be indistinguishable from one that worked.
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_is_attributed"
  CHECK (
    ("status" in ('waiting', 'withdrawn') and "decided_by" is null and "decided_at" is null)
    or ("status" in ('approved', 'declined') and "decided_by" is not null and "decided_at" is not null)
  );
