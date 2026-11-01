CREATE TABLE "ledger_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_key" varchar(400) NOT NULL,
	"record_id" varchar(64),
	"file_tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_row_customer_uq" ON "ledger_row" USING btree ("customer_key");