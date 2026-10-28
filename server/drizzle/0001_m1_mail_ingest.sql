CREATE TYPE "public"."category" AS ENUM('quality_issue', 'parts_request', 'refund', 'warranty', 'technical_support', 'order_inquiry', 'manual_request', 'registration', 'product_question', 'safety_hazard', 'injury_claim', 'missing_parts', 'damaged_shipping', 'purchase_inquiry', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending_review', 'replied', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('complete', 'partial', 'missing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."part_type" AS ENUM('battery', 'key', 'charger', 'wheels', 'tire', 'brakes', 'motor', 'light', 'display', 'frame', 'drivetrain', 'controller', 'accessories', 'other');--> statement-breakpoint
CREATE TYPE "public"."pipeline_state" AS ENUM('ingested', 'classified', 'drafted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('manual', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TABLE "email_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(127) NOT NULL,
	"size" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"content_id" varchar(998),
	"is_inline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(998) NOT NULL,
	"subject" text,
	"from_address" varchar(320),
	"from_name" varchar(255),
	"reply_to" varchar(320),
	"received_at" timestamp with time zone,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text,
	"in_reply_to" varchar(998),
	"ref_chain" text,
	"thread_id" varchar(998),
	"is_follow_up" boolean DEFAULT false NOT NULL,
	"status" "email_status" DEFAULT 'pending_review' NOT NULL,
	"pipeline_state" "pipeline_state" DEFAULT 'ingested' NOT NULL,
	"pipeline_error" text,
	"urgency" "urgency" DEFAULT 'normal' NOT NULL,
	"part_type" "part_type" DEFAULT 'other' NOT NULL,
	"category" "category" DEFAULT 'other' NOT NULL,
	"summary" text,
	"is_complaint" boolean DEFAULT true NOT NULL,
	"is_our_product" boolean DEFAULT true NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'unknown' NOT NULL,
	"missing_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_safety_hazard" boolean DEFAULT false NOT NULL,
	"draft_confidence" integer,
	"classified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"filtered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "sync_interval_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_attachment" ADD CONSTRAINT "email_attachment_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_attachment_email_id_idx" ON "email_attachment" USING btree ("email_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "email_message_message_id_uq" ON "email_message" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_message_status_idx" ON "email_message" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_message_from_lower_idx" ON "email_message" USING btree (lower("from_address"));--> statement-breakpoint
CREATE INDEX "email_message_received_at_idx" ON "email_message" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "email_message_thread_id_idx" ON "email_message" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "email_message_in_reply_to_idx" ON "email_message" USING btree ("in_reply_to");--> statement-breakpoint
CREATE INDEX "sync_run_started_at_idx" ON "sync_run" USING btree ("started_at");