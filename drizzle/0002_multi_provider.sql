CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"file_count" integer NOT NULL,
	"sha256" text NOT NULL,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "upload_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pending_upload_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "project_limit" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_provider_idx" ON "accounts" USING btree ("user_id","provider");--> statement-breakpoint
-- Data: setiap user lama punya satu akun GitHub; path repo = owner/nama.
INSERT INTO "accounts" ("id", "user_id", "provider", "provider_account_id", "login", "avatar_url", "created_at")
SELECT substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 16), "id", 'github', "github_id"::text, "login", "avatar_url", "created_at"
FROM "users";--> statement-breakpoint
UPDATE "projects" SET "repo_path" = "repo_owner" || '/' || "repo_name";
