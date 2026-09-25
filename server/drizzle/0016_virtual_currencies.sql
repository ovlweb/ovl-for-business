ALTER TYPE "public"."ledger_kind" ADD VALUE 'issuance' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'redemption' BEFORE 'adjustment';--> statement-breakpoint
CREATE TABLE "virtual_currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"decimals" integer NOT NULL,
	"registry_entry_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"supply" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_currencies_registry_entry_id_unique" UNIQUE("registry_entry_id")
);
--> statement-breakpoint
ALTER TABLE "virtual_currencies" ADD CONSTRAINT "virtual_currencies_registry_entry_id_registry_entries_id_fk" FOREIGN KEY ("registry_entry_id") REFERENCES "public"."registry_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_currencies" ADD CONSTRAINT "virtual_currencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;