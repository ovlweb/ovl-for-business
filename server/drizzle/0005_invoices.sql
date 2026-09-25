CREATE TYPE "public"."invoice_status" AS ENUM('open', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(32) NOT NULL,
	"issuer_type" "wallet_owner" NOT NULL,
	"issuer_user_id" uuid,
	"issuer_org_id" uuid,
	"recipient_type" "wallet_owner" NOT NULL,
	"recipient_user_id" uuid,
	"recipient_org_id" uuid,
	"currency" char(3) NOT NULL,
	"items" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"paid_from_wallet_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "invoices_single_issuer" CHECK (("invoices"."issuer_user_id" is null) <> ("invoices"."issuer_org_id" is null)),
	CONSTRAINT "invoices_single_recipient" CHECK (("invoices"."recipient_user_id" is null) <> ("invoices"."recipient_org_id" is null)),
	CONSTRAINT "invoices_total_positive" CHECK ("invoices"."total" > 0)
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_user_id_users_id_fk" FOREIGN KEY ("issuer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_org_id_organizations_id_fk" FOREIGN KEY ("issuer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recipient_org_id_organizations_id_fk" FOREIGN KEY ("recipient_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_from_wallet_id_wallets_id_fk" FOREIGN KEY ("paid_from_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_issuer_user_number_uq" ON "invoices" USING btree ("issuer_user_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_issuer_org_number_uq" ON "invoices" USING btree ("issuer_org_id","number");--> statement-breakpoint
CREATE INDEX "invoices_recipient_user_idx" ON "invoices" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_recipient_org_idx" ON "invoices" USING btree ("recipient_org_id","created_at");