CREATE TYPE "public"."identity_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "identity_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "identity_status" DEFAULT 'pending' NOT NULL,
	"legal_name" varchar(120) NOT NULL,
	"date_of_birth" date NOT NULL,
	"country" varchar(80) NOT NULL,
	"document_type" varchar(24) NOT NULL,
	"document_last4" varchar(4) NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "identity_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_checks_user_idx" ON "identity_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_checks_status_idx" ON "identity_checks" USING btree ("status");