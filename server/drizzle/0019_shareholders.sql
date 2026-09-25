ALTER TYPE "public"."ledger_kind" ADD VALUE 'dividend_in' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'dividend_out' BEFORE 'adjustment';--> statement-breakpoint
CREATE TABLE "company_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period" varchar(16) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"currency" char(3) NOT NULL,
	"revenue" bigint,
	"profit" bigint,
	"author_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dividends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"per_share" bigint NOT NULL,
	"shares" bigint NOT NULL,
	"holders" integer NOT NULL,
	"total" bigint NOT NULL,
	"note" varchar(200) DEFAULT '' NOT NULL,
	"status" "payroll_status" NOT NULL,
	"recipients" jsonb NOT NULL,
	"approval_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proposal_voters" (
	"proposal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shares" bigint NOT NULL,
	"option" varchar(16),
	"voted_at" timestamp with time zone,
	CONSTRAINT "proposal_voters_proposal_id_user_id_pk" PRIMARY KEY("proposal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"options" jsonb NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_early_at" timestamp with time zone,
	"total_shares" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_voters" ADD CONSTRAINT "proposal_voters_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_voters" ADD CONSTRAINT "proposal_voters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_reports_org_idx" ON "company_reports" USING btree ("organization_id","published_at");--> statement-breakpoint
CREATE INDEX "dividends_listing_idx" ON "dividends" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_listing_idx" ON "proposals" USING btree ("listing_id","created_at");