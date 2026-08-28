CREATE TABLE "notification_read" (
	"user_id" text NOT NULL,
	"notification_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_read_user_id_notification_key_pk" PRIMARY KEY("user_id","notification_key")
);
