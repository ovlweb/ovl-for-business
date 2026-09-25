ALTER TYPE "public"."application_type" ADD VALUE 'renewal';--> statement-breakpoint
ALTER TYPE "public"."registry_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD COLUMN "reminder_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "registry_expiry_idx" ON "registry_entries" USING btree ("status","expires_at");--> statement-breakpoint
-- Licences issued before expiry existed run a year from issue; business licences follow their company.
UPDATE "registry_entries" SET "expires_at" = "issued_at" + interval '12 months'
WHERE "kind" <> 'organization' AND coalesce("license_type", '') <> 'business';
