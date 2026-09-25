CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'filled', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'trade_in' BEFORE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'trade_out' BEFORE 'adjustment';--> statement-breakpoint
CREATE TABLE "shareholdings" (
	"listing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shares" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shareholdings_listing_id_user_id_pk" PRIMARY KEY("listing_id","user_id"),
	CONSTRAINT "shareholdings_non_negative" CHECK ("shareholdings"."shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"side" "order_side" NOT NULL,
	"price" bigint NOT NULL,
	"shares" bigint NOT NULL,
	"filled" bigint DEFAULT 0 NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_orders_filled" CHECK ("stock_orders"."filled" between 0 and "stock_orders"."shares")
);
--> statement-breakpoint
CREATE TABLE "stock_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buy_order_id" uuid NOT NULL,
	"sell_order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"taker_side" "order_side" NOT NULL,
	"price" bigint NOT NULL,
	"shares" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_listing_id_stock_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."stock_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_buy_order_id_stock_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."stock_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_sell_order_id_stock_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."stock_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_trades" ADD CONSTRAINT "stock_trades_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_orders_book_idx" ON "stock_orders" USING btree ("listing_id","side","status","price","created_at");--> statement-breakpoint
CREATE INDEX "stock_orders_user_idx" ON "stock_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_trades_listing_idx" ON "stock_trades" USING btree ("listing_id","created_at");--> statement-breakpoint
-- Holdings so far come from investments.
INSERT INTO "shareholdings" ("listing_id", "user_id", "shares")
SELECT "listing_id", "investor_id", sum("shares") FROM "investments" GROUP BY "listing_id", "investor_id";
