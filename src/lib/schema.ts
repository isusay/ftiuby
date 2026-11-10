import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createId } from "./id";

export const roleEnum = pgEnum("role", ["USER", "ADMIN"]);

/**
 * Alur status project:
 * SUBMITTED → (admin) → BUILDING → LIVE / FAILED
 * SUBMITTED → (admin) → NEEDS_REVISION → (user perbarui) → SUBMITTED
 * apa pun → ARCHIVED → (ajukan lagi) → SUBMITTED
 */
export const statusEnum = pgEnum("project_status", [
  "SUBMITTED",
  "NEEDS_REVISION",
  "BUILDING",
  "LIVE",
  "FAILED",
  "ARCHIVED",
]);

export const frameworkEnum = pgEnum("framework", [
  "HTML",
  "VITE",
  "ASTRO",
  "NEXT_EXPORT",
  "NUXT",
  "SVELTEKIT",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(createId),
  githubId: integer("github_id").notNull().unique(),
  login: text("login").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull().default("USER"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  inviteId: text("invite_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  id: text("id").primaryKey().$defaultFn(createId),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull().default("Portfolio"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    branch: text("branch").notNull(),
    framework: frameworkEnum("framework").notNull(),
    outputDir: text("output_dir").notNull(),
    buildCommand: text("build_command"),
    packageManager: text("package_manager"),
    status: statusEnum("status").notNull().default("SUBMITTED"),
    adminNote: text("admin_note"),
    dokployAppId: text("dokploy_app_id"),
    deployState: text("deploy_state"), // idle | running | done | error
    webhookSecret: text("webhook_secret").notNull(),
    lastDeployAt: timestamp("last_deploy_at", { withTimezone: true }),
    liveAt: timestamp("live_at", { withTimezone: true }),
    likeCount: integer("like_count").notNull().default(0),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("projects_status_likes_idx").on(t.status, t.likeCount), index("projects_user_idx").on(t.userId)],
);

export const likes = pgTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectStatus = (typeof statusEnum.enumValues)[number];
export type Framework = (typeof frameworkEnum.enumValues)[number];
