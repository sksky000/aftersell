CREATE TABLE "history_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(998) NOT NULL,
	"sent_at" timestamp with time zone,
	"subject" text,
	"to_address" varchar(320),
	"reply_text" text NOT NULL,
	"customer_text" text DEFAULT '' NOT NULL,
	"is_after_sales" boolean,
	"category" "category",
	"part_type" "part_type",
	"customer_sent_media" boolean,
	"labeled_at" timestamp with time zone,
	"label_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD COLUMN "status" varchar(16) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD COLUMN "source" varchar(16) DEFAULT 'miaoda' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD COLUMN "sample_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reply_correction" ADD COLUMN "mined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "style_rule" ADD COLUMN "status" varchar(16) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "style_rule" ADD COLUMN "correction_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "style_rule" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "style_rule" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "history_reply_message_id_uq" ON "history_reply" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "history_reply_cluster_idx" ON "history_reply" USING btree ("category","part_type");--> statement-breakpoint
ALTER TABLE "knowledge_card" ADD CONSTRAINT "knowledge_card_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_rule" ADD CONSTRAINT "style_rule_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;