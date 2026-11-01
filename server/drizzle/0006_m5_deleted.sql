CREATE TABLE "deleted_message" (
	"message_id" varchar(998) PRIMARY KEY NOT NULL,
	"subject" text,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deleted_message" ADD CONSTRAINT "deleted_message_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;