CREATE TABLE "intake_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"storage_path" text,
	"sha256" text,
	"looks_like" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_channel" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_built' NOT NULL,
	"auto_classify" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"last_received_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_key" text NOT NULL,
	"external_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"from_address" text,
	"from_name" text,
	"subject" text,
	"body_text" text,
	"party_id" uuid,
	"person_id" uuid,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"classified_as" text,
	"confidence" numeric(4, 3),
	"matched_rule_id" uuid,
	"committed_entity" text,
	"committed_entity_id" uuid,
	"committed_at" timestamp with time zone,
	"committed_by" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"matcher" jsonb NOT NULL,
	"creates" text NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"label_key" text NOT NULL,
	"action_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_attachment" ADD CONSTRAINT "intake_attachment_message_id_intake_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."intake_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_message" ADD CONSTRAINT "intake_message_channel_key_intake_channel_key_fk" FOREIGN KEY ("channel_key") REFERENCES "public"."intake_channel"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_message" ADD CONSTRAINT "intake_message_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_message" ADD CONSTRAINT "intake_message_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_message" ADD CONSTRAINT "intake_message_matched_rule_id_routing_rule_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."routing_rule"("id") ON DELETE no action ON UPDATE no action;