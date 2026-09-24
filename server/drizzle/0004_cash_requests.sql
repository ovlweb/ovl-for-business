CREATE TYPE "public"."cash_request_status" AS ENUM('pending', 'completed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "cash_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "cash_type" NOT NULL,
	"method" "cash_method" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "cash_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"handled_by" uuid,
	"cash_operation_id" uuid,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_requests" ADD CONSTRAINT "cash_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_requests" ADD CONSTRAINT "cash_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_requests" ADD CONSTRAINT "cash_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_requests" ADD CONSTRAINT "cash_requests_cash_operation_id_cash_operations_id_fk" FOREIGN KEY ("cash_operation_id") REFERENCES "public"."cash_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_requests_status_idx" ON "cash_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "cash_requests_wallet_idx" ON "cash_requests" USING btree ("wallet_id");