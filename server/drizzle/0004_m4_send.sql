CREATE TYPE "public"."send_result" AS ENUM('succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."reply_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
CREATE TABLE "reply_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"reply_id" uuid,
	"category" "category" NOT NULL,
	"part_type" "part_type" NOT NULL,
	"original_draft" text NOT NULL,
	"final_content" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"reply_id" uuid,
	"idempotency_key" varchar(64) NOT NULL,
	"to_address" varchar(320) NOT NULL,
	"subject" text,
	"message_id" varchar(998),
	"result" "send_result" NOT NULL,
	"error" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" varchar(100) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "html_content" text;--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "send_idempotency_key" varchar(64);--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "reply_message_id" varchar(998);--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "subject_sent" text;--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "sent_to" varchar(320);--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_reply" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "reply_correction" ADD CONSTRAINT "reply_correction_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_correction" ADD CONSTRAINT "reply_correction_reply_id_email_reply_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."email_reply"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_correction" ADD CONSTRAINT "reply_correction_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_reply_id_email_reply_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."email_reply"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_correction_email_idx" ON "reply_correction" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "send_log_email_idx" ON "send_log" USING btree ("email_id");--> statement-breakpoint
ALTER TABLE "email_reply" ADD CONSTRAINT "email_reply_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_reply_send_key_uq" ON "email_reply" USING btree ("send_idempotency_key");