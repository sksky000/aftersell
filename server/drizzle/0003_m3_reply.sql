CREATE TYPE "public"."reply_status" AS ENUM('draft', 'sent', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."rule_slot" AS ENUM('channel', 'language', 'safety', 'evidence_policy', 'evidence_note', 'action', 'business_fact', 'part_knowledge', 'closing');--> statement-breakpoint
CREATE TABLE "email_reply" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "reply_status" DEFAULT 'draft' NOT NULL,
	"draft_content" text NOT NULL,
	"final_content" text,
	"context" text,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" varchar(32),
	"model" varchar(100),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_key" varchar(200) NOT NULL,
	"category" varchar(64) NOT NULL,
	"part_type" varchar(32) NOT NULL,
	"image_flag" varchar(16) NOT NULL,
	"model_code" varchar(64),
	"sample_size" integer DEFAULT 0 NOT NULL,
	"skeleton" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing" jsonb,
	"drift" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_card_cluster_key_unique" UNIQUE("cluster_key")
);
--> statement-breakpoint
CREATE TABLE "outbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(998) NOT NULL,
	"in_reply_to" varchar(998),
	"ref_chain" text,
	"subject" text,
	"to_addresses" text,
	"sent_at" timestamp with time zone,
	"body_text" text DEFAULT '' NOT NULL,
	"source" varchar(16) DEFAULT 'imap_sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_type" "part_type" NOT NULL,
	"model_code" varchar(40),
	"label" varchar(200) NOT NULL,
	"amount_cents" integer NOT NULL,
	"includes_shipping" boolean DEFAULT true NOT NULL,
	"note" varchar(300),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_knowledge" (
	"model_code" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code_pattern" varchar(200) NOT NULL,
	"matchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"electric" boolean DEFAULT false NOT NULL,
	"no_toolkit" boolean DEFAULT false NOT NULL,
	"knowledge" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"description" varchar(200) NOT NULL,
	"slot" "rule_slot" NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"when" jsonb,
	"text" text NOT NULL,
	"source" varchar(300),
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reply_id" uuid NOT NULL,
	"rule_key" varchar(100) NOT NULL,
	"slot" "rule_slot" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"category" "category",
	"part_type" "part_type",
	"enabled" boolean DEFAULT true NOT NULL,
	"source" varchar(300),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_reply" ADD CONSTRAINT "email_reply_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_reply" ADD CONSTRAINT "email_reply_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_hit" ADD CONSTRAINT "rule_hit_reply_id_email_reply_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."email_reply"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_reply_email_version_uq" ON "email_reply" USING btree ("email_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_message_message_id_uq" ON "outbound_message" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "outbound_message_in_reply_to_idx" ON "outbound_message" USING btree ("in_reply_to");--> statement-breakpoint
CREATE UNIQUE INDEX "price_item_model_part_uq" ON "price_item" USING btree (coalesce("model_code", ''),"part_type","label");--> statement-breakpoint
CREATE INDEX "rule_hit_reply_idx" ON "rule_hit" USING btree ("reply_id");--> statement-breakpoint
CREATE INDEX "rule_hit_rule_idx" ON "rule_hit" USING btree ("rule_key");