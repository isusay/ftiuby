import "server-only";
import { GitError } from "./git/error";

/** Klien minimal GitLab REST API v4 (default gitlab.com, bisa self-hosted lewat GITLAB_URL). */
export function gitlabUrl() {
  return (process.env.GITLAB_URL || "https://gitlab.com").replace(/\/$/, "");
}

async function glFetch(path: string, token?: string) {
  const auth = token ?? process.env.GITLAB_TOKEN;
  return fetch(`${gitlabUrl()}/api/v4${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ftiuby",
      ...(token ? { Authorization: `Bearer ${token}` } : auth ? { "PRIVATE-TOKEN": auth } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}

function fail(status: number): never {
  const msg =
    status === 404
      ? "Repository atau branch tidak ditemukan di GitLab, atau repository tidak public."
      : status === 429 || status === 403
        ? "Batas akses GitLab API tercapai. Coba lagi beberapa menit lagi."
        : `GitLab API error ${status}`;
  throw new GitError(msg, status);
}

async function gl<T>(path: string, token?: string): Promise<T> {
  const res = await glFetch(path, token);
  if (!res.ok) fail(res.status);
  return res.json() as Promise<T>;
}

export type GlUser = { id: number; username: string; name: string | null; avatar_url: string | null };
export type GlProject = {
  id: number;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string | null;
  visibility?: "public" | "internal" | "private";
  archived?: boolean;
  namespace: { id: number; kind: "user" | "group"; path: string; full_path: string };
  owner?: { id: number; username: string };
};

const enc = encodeURIComponent;

export const gitlab = {
  me: (token: string) => gl<GlUser>("/user", token),

  project: (pathOrId: string | number) => gl<GlProject>(`/projects/${enc(String(pathOrId))}`),

  userProjects: (userId: string) =>
    gl<GlProject[]>(`/users/${enc(userId)}/projects?visibility=public&archived=false&order_by=last_activity_at&per_page=100`),

  userByUsername: async (username: string) => (await gl<{ id: number }[]>(`/users?username=${enc(username)}`))[0] ?? null,

  branches: (path: string) => gl<{ name: string }[]>(`/projects/${enc(path)}/repository/branches?per_page=100`),

  branch: (path: string, branch: string) =>
    gl<{ commit: { id: string } }>(`/projects/${enc(path)}/repository/branches/${enc(branch)}`),

  /** Seluruh isi repo pada satu commit (dipaginasi; dipotong bila sangat besar). */
  async tree(path: string, ref: string, maxPages = 30) {
    const entries: { id: string; path: string; type: "blob" | "tree" | "commit" }[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await glFetch(
        `/projects/${enc(path)}/repository/tree?ref=${enc(ref)}&recursive=true&per_page=100&page=${page}`,
      );
      if (!res.ok) fail(res.status);
      entries.push(...((await res.json()) as typeof entries));
      const next = res.headers.get("x-next-page");
      if (!next) return { entries, truncated: false };
    }
    return { entries, truncated: true };
  },

  async rawFile(path: string, ref: string, file: string): Promise<string | null> {
    const res = await glFetch(`/projects/${enc(path)}/repository/files/${enc(file)}/raw?ref=${enc(ref)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new GitError(`Gagal membaca ${file} (${res.status})`, res.status);
    const text = await res.text();
    return text.length > 512_000 ? null : text;
  },
};
