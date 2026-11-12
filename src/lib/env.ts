import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} belum diisi`);
  return v;
}

/** Dibaca lazy supaya `next build` tidak gagal tanpa env. */
export const env = {
  get appUrl() {
    return req("APP_URL").replace(/\/$/, "");
  },
  get sitesDomain() {
    return req("SITES_DOMAIN"); // contoh: ftiuby.cloud → nama.ftiuby.cloud
  },
  get sessionSecret() {
    const s = req("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET minimal 32 karakter");
    return s;
  },
  /** OAuth GitHub; provider aktif bila client ID & secret diisi. */
  get githubClientId() {
    return process.env.GITHUB_CLIENT_ID || null;
  },
  get githubClientSecret() {
    return process.env.GITHUB_CLIENT_SECRET || null;
  },
  /** OAuth GitLab (gitlab.com atau GITLAB_URL); provider aktif bila client ID & secret diisi. */
  get gitlabClientId() {
    return process.env.GITLAB_CLIENT_ID || null;
  },
  get gitlabClientSecret() {
    return process.env.GITLAB_CLIENT_SECRET || null;
  },
  /** Upload ZIP (Drop) aktif kecuali ENABLE_DROP=false. */
  get dropEnabled() {
    return process.env.ENABLE_DROP !== "false";
  },
  /** Batas project aktif (belum diarsipkan) per user, bisa ditimpa admin per user. */
  get maxProjectsPerUser() {
    const n = Number(process.env.MAX_PROJECTS_PER_USER ?? 3);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
  },
  /** Token opsional (tanpa scope) agar limit GitHub API naik dari 60 ke 5000/jam. */
  get githubToken() {
    return process.env.GITHUB_TOKEN || undefined;
  },
  get dokployUrl() {
    return req("DOKPLOY_URL").replace(/\/$/, "");
  },
  get dokployApiKey() {
    return req("DOKPLOY_API_KEY");
  },
  get dokployEnvironmentId() {
    return req("DOKPLOY_ENVIRONMENT_ID");
  },
  get dokployServerId() {
    return process.env.DOKPLOY_SERVER_ID || null;
  },
  /**
   * Identitas admin dalam bentuk "provider:login", dari ADMIN_LOGINS
   * (misal "github:alice,gitlab:bob"; tanpa prefix = github) dan ADMIN_GITHUB_LOGINS (lama).
   */
  get adminIdentities(): string[] {
    const list = [
      ...(process.env.ADMIN_LOGINS ?? "").split(","),
      ...(process.env.ADMIN_GITHUB_LOGINS ?? "").split(",").map((s) => (s.trim() ? `github:${s.trim()}` : "")),
    ];
    return list
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => (s.includes(":") ? s : `github:${s}`));
  },
  get betaSlots() {
    return Number(process.env.BETA_SLOTS ?? 25);
  },
  get reservedSlugs(): string[] {
    const extra = (process.env.RESERVED_SLUGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return [
      "www", "api", "app", "admin", "dashboard", "dokploy", "panel", "mail", "smtp", "imap",
      "ftp", "ns1", "ns2", "cdn", "static", "assets", "status", "docs", "blog", "auth",
      "login", "traefik", "git", "registry", "db", "ftiuby", "root", "support", "help",
      ...extra,
    ];
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};
