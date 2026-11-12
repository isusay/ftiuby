import "server-only";
import { env } from "./env";
import { getAuthedUser } from "./github";
import { gitlab, gitlabUrl } from "./gitlab";
import type { GitProvider } from "./schema";

export type OAuthProfile = {
  provider: GitProvider;
  providerAccountId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type OAuthProvider = {
  label: string;
  enabled(): boolean;
  authorizeUrl(state: string): string;
  /** Tukar code dengan token, baca profil, lalu buang token (tidak disimpan). */
  profile(code: string): Promise<OAuthProfile | null>;
};

/** URL callback yang didaftarkan di OAuth App. GitHub memakai path lama agar konfigurasi lama tetap jalan. */
export function callbackUrl(provider: GitProvider) {
  return provider === "github" ? `${env.appUrl}/api/auth/callback` : `${env.appUrl}/api/auth/callback/${provider}`;
}

async function postJson(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json().catch(() => null)) as { access_token?: string } | null;
}

export const oauthProviders: Record<GitProvider, OAuthProvider> = {
  github: {
    label: "GitHub",
    enabled: () => !!(env.githubClientId && env.githubClientSecret),
    authorizeUrl(state) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", env.githubClientId!);
      url.searchParams.set("redirect_uri", callbackUrl("github"));
      url.searchParams.set("scope", "read:user");
      url.searchParams.set("state", state);
      url.searchParams.set("allow_signup", "true");
      return url.toString();
    },
    async profile(code) {
      const token = await postJson("https://github.com/login/oauth/access_token", {
        client_id: env.githubClientId!,
        client_secret: env.githubClientSecret!,
        code,
        redirect_uri: callbackUrl("github"),
      });
      if (!token?.access_token) return null;
      const u = await getAuthedUser(token.access_token);
      return { provider: "github", providerAccountId: String(u.id), login: u.login, name: u.name, avatarUrl: u.avatar_url };
    },
  },
  gitlab: {
    label: "GitLab",
    enabled: () => !!(env.gitlabClientId && env.gitlabClientSecret),
    authorizeUrl(state) {
      const url = new URL(`${gitlabUrl()}/oauth/authorize`);
      url.searchParams.set("client_id", env.gitlabClientId!);
      url.searchParams.set("redirect_uri", callbackUrl("gitlab"));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "read_user");
      url.searchParams.set("state", state);
      return url.toString();
    },
    async profile(code) {
      const token = await postJson(`${gitlabUrl()}/oauth/token`, {
        client_id: env.gitlabClientId!,
        client_secret: env.gitlabClientSecret!,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl("gitlab"),
      });
      if (!token?.access_token) return null;
      const u = await gitlab.me(token.access_token);
      return { provider: "gitlab", providerAccountId: String(u.id), login: u.username, name: u.name, avatarUrl: u.avatar_url };
    },
  },
};

export function enabledProviders(): GitProvider[] {
  return (Object.keys(oauthProviders) as GitProvider[]).filter((p) => oauthProviders[p].enabled());
}

export function isAdminIdentity(accts: { provider: string; login: string }[]) {
  const admins = env.adminIdentities;
  return accts.some((a) => admins.includes(`${a.provider}:${a.login.toLowerCase()}`));
}
