CREATE TABLE "risk_acknowledgements" (
	"user_id" uuid NOT NULL,
	"version" varchar(16) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_acknowledgements_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "risk_acknowledgements" ADD CONSTRAINT "risk_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;