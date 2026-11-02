CREATE TYPE "public"."trial_rating" AS ENUM('ready', 'minor', 'major', 'unusable');--> statement-breakpoint
CREATE TABLE "trial_review" (
	"email_id" uuid PRIMARY KEY NOT NULL,
	"rating" "trial_rating" NOT NULL,
	"note" text,
	"reviewer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_account" ADD COLUMN "trial_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_review" ADD CONSTRAINT "trial_review_email_id_email_message_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_review" ADD CONSTRAINT "trial_review_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;