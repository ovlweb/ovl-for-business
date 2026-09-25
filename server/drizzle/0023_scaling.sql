CREATE TABLE "rate_limits" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realtime_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realtime_presence" (
	"instance_id" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_presence_instance_id_user_id_pk" PRIMARY KEY("instance_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "realtime_presence" ADD CONSTRAINT "realtime_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_presence_user_idx" ON "realtime_presence" USING btree ("user_id");