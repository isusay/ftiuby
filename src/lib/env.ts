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
  get githubClientId() {
    return req("GITHUB_CLIENT_ID");
  },
  get githubClientSecret() {
    return req("GITHUB_CLIENT_SECRET");
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
  get adminLogins(): string[] {
    return (process.env.ADMIN_GITHUB_LOGINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
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
