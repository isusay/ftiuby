import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  customType,
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
  // Nama tampilan (username dari akun pertama). Identitas sebenarnya ada di tabel accounts.
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull().default("USER"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  inviteId: text("invite_id"),
  /** Kuota project aktif khusus user ini; null = pakai MAX_PROJECTS_PER_USER. */
  projectLimit: integer("project_limit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Provider login & sumber repository. "drop" = upload ZIP (tanpa akun). */
export const GIT_PROVIDERS = ["github", "gitlab"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];
export type SourceProvider = GitProvider | "drop";

/** Akun provider yang terhubung ke satu user. Satu user bisa punya GitHub dan GitLab sekaligus. */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<GitProvider>().notNull(),
    /** ID numerik akun di provider (disimpan sebagai teks). Identitas yang dipegang. */
    providerAccountId: text("provider_account_id").notNull(),
    /** Username terkini di provider (cache, bisa berubah). */
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_idx").on(t.provider, t.providerAccountId),
    uniqueIndex("accounts_user_provider_idx").on(t.userId, t.provider),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** File ZIP yang diunggah untuk project bersumber "drop" (sudah dinormalisasi). */
export const uploads = pgTable("uploads", {
  id: text("id").primaryKey().$defaultFn(createId),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  size: integer("size").notNull(),
  fileCount: integer("file_count").notNull(),
  sha256: text("sha256").notNull(),
  fingerprint: text("fingerprint"),
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
    /** github | gitlab | drop */
    provider: text("provider").$type<SourceProvider>().notNull().default("github"),
    /** Path repo di provider, misal "alice/web" atau "grup/sub/web" (cache nama terkini). */
    repoPath: text("repo_path"),
    /** Project drop: ZIP yang sedang/terakhir tayang, dan ZIP baru yang menunggu tinjauan. */
    uploadId: text("upload_id"),
    pendingUploadId: text("pending_upload_id"),
    /** ID numerik repo di provider; repoPath hanya cache nama terkini. Null untuk drop. */
    repoId: integer("repo_id"),
    /** Null untuk project drop. */
    branch: text("branch"),
    framework: frameworkEnum("framework").notNull(),
    outputDir: text("output_dir").notNull(),
    buildCommand: text("build_command"),
    packageManager: text("package_manager"),
    status: statusEnum("status").notNull().default("SUBMITTED"),
    adminNote: text("admin_note"),
    dokployAppId: text("dokploy_app_id"),
    deployState: text("deploy_state"), // idle | running | done | error
    webhookSecret: text("webhook_secret").notNull(),
    /** Fingerprint file build saat terakhir ditinjau admin; deploy otomatis hanya jika masih sama. */
    reviewedFingerprint: text("reviewed_fingerprint"),
    reviewedCommit: text("reviewed_commit"),
    /** Diisi saat update ditahan karena file build berubah; dikosongkan saat admin meninjau. */
    reviewHeldAt: timestamp("review_held_at", { withTimezone: true }),
    reviewHeldReason: text("review_held_reason"),
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
