CREATE TYPE "public"."cash_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "cash_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"cash_request_id" uuid,
	"wallet_id" uuid NOT NULL,
	"type" "cash_type" NOT NULL,
	"method" "cash_method" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"reference" varchar(128) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "cash_approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"reject_reason" text,
	"cash_operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_cash_request_id_cash_requests_id_fk" FOREIGN KEY ("cash_request_id") REFERENCES "public"."cash_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_approvals" ADD CONSTRAINT "cash_approvals_cash_operation_id_cash_operations_id_fk" FOREIGN KEY ("cash_operation_id") REFERENCES "public"."cash_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_approvals_status_idx" ON "cash_approvals" USING btree ("status","created_at");