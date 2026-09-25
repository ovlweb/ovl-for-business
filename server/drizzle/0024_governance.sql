CREATE TABLE "transparency_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"stats" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "council_term_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transparency_reports" ADD CONSTRAINT "transparency_reports_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transparency_reports_period_idx" ON "transparency_reports" USING btree ("period_end");