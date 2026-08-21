CREATE TABLE "document_type" (
	"kind" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"legal_value" text NOT NULL,
	"numbering" text NOT NULL,
	"converts_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
