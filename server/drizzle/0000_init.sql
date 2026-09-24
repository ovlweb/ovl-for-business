CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."application_type" AS ENUM('company', 'license', 'moderator', 'council', 'news_channel');--> statement-breakpoint
CREATE TYPE "public"."cash_method" AS ENUM('manager_transfer', 'physical_cash');--> statement-breakpoint
CREATE TYPE "public"."cash_type" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."chat_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."chat_type" AS ENUM('direct', 'group', 'channel', 'support', 'council', 'moderation');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'investment_in', 'investment_out', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'halted', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'director', 'accountant', 'member');--> statement-breakpoint
CREATE TYPE "public"."registry_kind" AS ENUM('organization', 'license', 'virtual_country');--> statement-breakpoint
CREATE TYPE "public"."registry_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'moderator', 'manager', 'council', 'admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."wallet_owner" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "application_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage_key" varchar(32) NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewer_role" "role" NOT NULL,
	"decision" "review_decision" NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"checklist" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "application_type" NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'pending' NOT NULL,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "cash_type" NOT NULL,
	"method" "cash_method" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"reference" varchar(128) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"processed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_members" (
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "chat_member_role" DEFAULT 'member' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_read_message_id" bigint DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_members_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "chat_type" NOT NULL,
	"title" varchar(128) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"direct_key" varchar(80),
	"handle" varchar(32),
	"is_public" boolean DEFAULT false NOT NULL,
	"support_status" "support_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "chats_direct_key_unique" UNIQUE("direct_key"),
	CONSTRAINT "chats_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"owner_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_owner_id_contact_id_pk" PRIMARY KEY("owner_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "fund_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"reason" varchar(32) NOT NULL,
	"reference_id" uuid,
	"unlocks_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"from_wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"shares" bigint NOT NULL,
	"frozen_amount" bigint NOT NULL,
	"unlocks_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"counterparty_wallet_id" uuid,
	"reference_type" varchar(32),
	"reference_id" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_to_id" bigint,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website" text,
	"country" varchar(120),
	"base_currency" char(3) NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"owner_id" uuid NOT NULL,
	"registry_number" varchar(32),
	"application_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "registry_counters" (
	"kind" varchar(32) PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(32) NOT NULL,
	"kind" "registry_kind" NOT NULL,
	"license_type" varchar(32),
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website" text,
	"holder_user_id" uuid,
	"holder_organization_id" uuid,
	"status" "registry_status" DEFAULT 'active' NOT NULL,
	"application_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_entries_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "stock_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticker" varchar(8) NOT NULL,
	"currency" char(3) NOT NULL,
	"share_price" bigint NOT NULL,
	"total_shares" bigint NOT NULL,
	"shares_sold" bigint DEFAULT 0 NOT NULL,
	"freeze_bps" integer NOT NULL,
	"lock_days" integer NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_listings_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "stock_listings_ticker_unique" UNIQUE("ticker"),
	CONSTRAINT "stock_listings_shares_sold" CHECK ("stock_listings"."shares_sold" between 0 and "stock_listings"."total_shares")
);
--> statement-breakpoint
CREATE TABLE "stock_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"text" varchar(500) NOT NULL,
	"media_url" text,
	"link_url" text,
	"background" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_views_story_id_user_id_pk" PRIMARY KEY("story_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'user' NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "wallet_owner" NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"currency" char(3) NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_non_negative" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_single_owner" CHECK (("wallets"."user_id" is null) <> ("wallets"."organization_id" is null))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_operations" ADD CONSTRAINT "cash_operations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_operations" ADD CONSTRAINT "cash_operations_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contact_id_users_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_locks" ADD CONSTRAINT "fund_locks_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_investor_id_users_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_from_wallet_id_wallets_id_fk" FOREIGN KEY ("from_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD CONSTRAINT "registry_entries_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD CONSTRAINT "registry_entries_holder_organization_id_organizations_id_fk" FOREIGN KEY ("holder_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_listings" ADD CONSTRAINT "stock_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_price_history" ADD CONSTRAINT "stock_price_history_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_reviews_once_uq" ON "application_reviews" USING btree ("application_id","stage_key","reviewer_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "applications_applicant_idx" ON "applications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cash_operations_created_idx" ON "cash_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_members_user_idx" ON "chat_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chats_type_idx" ON "chats" USING btree ("type");--> statement-breakpoint
CREATE INDEX "fund_locks_wallet_idx" ON "fund_locks" USING btree ("wallet_id","unlocks_at");--> statement-breakpoint
CREATE INDEX "investments_listing_idx" ON "investments" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "investments_investor_idx" ON "investments" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "ledger_wallet_idx" ON "ledger_entries" USING btree ("wallet_id","id");--> statement-breakpoint
CREATE INDEX "messages_chat_idx" ON "messages" USING btree ("chat_id","id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_kind_idx" ON "registry_entries" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "registry_title_idx" ON "registry_entries" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "price_history_listing_idx" ON "stock_price_history" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "stories_expires_idx" ON "stories" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_currency_uq" ON "wallets" USING btree ("user_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_org_currency_uq" ON "wallets" USING btree ("organization_id","currency");