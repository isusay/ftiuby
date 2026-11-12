ALTER TABLE "users" DROP CONSTRAINT "users_login_unique";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_id" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "reviewed_fingerprint" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "reviewed_commit" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "review_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "review_held_reason" text;