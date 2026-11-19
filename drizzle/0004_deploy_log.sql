ALTER TABLE "projects" ADD COLUMN "deploy_log" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deploy_error_at" timestamp with time zone;