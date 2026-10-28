CREATE TYPE "public"."adjudication_fact" AS ENUM('non_phoenix_product');--> statement-breakpoint
CREATE TYPE "public"."llm_slot" AS ENUM('classify', 'vision', 'draft', 'subject_tag', 'translate');--> statement-breakpoint
CREATE TYPE "public"."recognition_status" AS ENUM('succeeded', 'failed', 'unsupported');--> statement-breakpoint
CREATE TABLE "attachment_recognition" (
	"sha256" char(64) PRIMARY KEY NOT NULL,
	"status" "recognition_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"text" text,
	"reason" varchar(64),
	"provider" varchar(32),
	"model" varchar(100),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_adjudication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_email" varchar(320) NOT NULL,
	"fact_type" "adjudication_fact" NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" "llm_slot" NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(100) NOT NULL,
	"email_id" uuid,
	"ok" boolean NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_hash" char(64) NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "classify_detail" jsonb;--> statement-breakpoint
ALTER TABLE "customer_adjudication" ADD CONSTRAINT "customer_adjudication_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_adjudication_email_fact_uq" ON "customer_adjudication" USING btree (lower("customer_email"),"fact_type");--> statement-breakpoint
CREATE INDEX "llm_call_created_at_idx" ON "llm_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_call_email_id_idx" ON "llm_call" USING btree ("email_id");