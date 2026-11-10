import "server-only";
import { env } from "./env";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const RAW = process.env.GITHUB_RAW_URL ?? "https://raw.githubusercontent.com";

export class GitHubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function gh<T>(path: string, token?: string): Promise<T> {
  const auth = token ?? env.githubToken;
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ftiuby",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const msg =
      res.status === 404
        ? "Repository atau branch tidak ditemukan, atau repository tidak public."
        : res.status === 403
          ? "Batas akses GitHub API tercapai. Coba lagi beberapa menit lagi."
          : `GitHub API error ${res.status}`;
    throw new GitHubError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export type GhUser = { id: number; login: string; name: string | null; avatar_url: string };
export type GhRepo = {
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  owner: { login: string };
  pushed_at: string;
};

export function getAuthedUser(token: string) {
  return gh<GhUser>("/user", token);
}

/** Repository public milik user (bukan fork, bukan archived), terbaru di atas. */
export async function listPublicRepos(login: string): Promise<GhRepo[]> {
  const repos = await gh<GhRepo[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`);
  return repos.filter((r) => !r.private && !r.archived);
}

export function getRepo(owner: string, repo: string) {
  return gh<GhRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

export async function listBranches(owner: string, repo: string): Promise<string[]> {
  const b = await gh<{ name: string }[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
  );
  return b.map((x) => x.name);
}

export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; size?: number };

export async function getTree(owner: string, repo: string, branch: string) {
  const t = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return t;
}

/** Ambil isi file teks kecil (package.json, next.config, dll). */
export async function getFileText(owner: string, repo: string, branch: string, path: string): Promise<string | null> {
  const res = await fetch(
    `${RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branch.split("/").map(encodeURIComponent).join("/")}/${path}`,
    { cache: "no-store", headers: { "User-Agent": "ftiuby" } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(`Gagal membaca ${path} (${res.status})`, res.status);
  const text = await res.text();
  return text.length > 512_000 ? null : text;
}
