CREATE TYPE "public"."user_role" AS ENUM('agent', 'supervisor', 'admin');--> statement-breakpoint
CREATE TABLE "email_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_address" varchar(255) NOT NULL,
	"auth_code_cipher" text NOT NULL,
	"imap_host" varchar(255) NOT NULL,
	"imap_port" integer NOT NULL,
	"smtp_host" varchar(255) NOT NULL,
	"smtp_port" integer NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"keep_unread" boolean DEFAULT true NOT NULL,
	"hotline_only" boolean DEFAULT false NOT NULL,
	"registration_only" boolean DEFAULT false NOT NULL,
	"first_contact_only" boolean DEFAULT false NOT NULL,
	"max_per_run" integer DEFAULT 20 NOT NULL,
	"sync_date_from" date,
	"sync_date_to" date,
	"last_sync_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'agent' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"feishu_open_id" varchar(128),
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_account" ADD CONSTRAINT "email_account_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_feishu_open_id_uq" ON "users" USING btree ("feishu_open_id");