ALTER TABLE "users" DROP CONSTRAINT "users_github_id_unique";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "branch" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "repo_owner";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "repo_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "github_id";