CREATE TYPE "public"."snippet_kind" AS ENUM('quick', 'sop');--> statement-breakpoint
CREATE TABLE "snippet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_key" varchar(100),
	"kind" "snippet_kind" NOT NULL,
	"label" varchar(60) NOT NULL,
	"text" text NOT NULL,
	"category" "category",
	"part_type" "part_type",
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "translation_zh" text;--> statement-breakpoint
CREATE UNIQUE INDEX "snippet_seed_key_uq" ON "snippet" USING btree ("seed_key");