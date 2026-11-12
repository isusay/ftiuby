import "server-only";
import type { GitProvider } from "../schema";
import { GitError } from "./error";
import * as gh from "../github";
import { gitlab, gitlabUrl, type GlProject } from "../gitlab";

export { GitError };

/** Repository di provider mana pun, dalam bentuk yang sama. */
export type RepoInfo = {
  id: number;
  /** "owner/nama" (GitHub) atau "namespace/.../nama" (GitLab). */
  path: string;
  name: string;
  /** ID akun pemilik di provider; null bila dimiliki organisasi/grup. */
  ownerId: string | null;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  description: string | null;
};

export type FileEntry = { path: string; sha: string };

export type Snapshot = {
  commitSha: string;
  files: FileEntry[];
  hasSubmodules: boolean;
  truncated: boolean;
};

export type LinkedAccount = { providerAccountId: string; login: string };

export interface GitHost {
  id: GitProvider;
  label: string;
  /** Repository public milik akun ini (bukan milik organisasi/grup). */
  listOwnedPublicRepos(account: LinkedAccount): Promise<RepoInfo[]>;
  getRepo(path: string): Promise<RepoInfo>;
  getRepoById(id: number): Promise<RepoInfo>;
  listBranches(path: string): Promise<string[]>;
  snapshot(path: string, branch: string): Promise<Snapshot>;
  readFile(path: string, ref: string, file: string): Promise<string | null>;
  cloneUrl(path: string): string;
  treeUrl(path: string, branch: string): string;
  compareUrl(path: string, from: string, to: string): string;
  commitsUrl(path: string, branch: string): string;
}

/* ---------- GitHub ---------- */

function fromGh(r: gh.GhRepo): RepoInfo {
  return {
    id: r.id,
    path: r.full_name,
    name: r.name,
    ownerId: String(r.owner.id),
    private: r.private,
    archived: r.archived,
    defaultBranch: r.default_branch,
    description: r.description,
  };
}

function splitGh(path: string) {
  const [owner, repo] = path.split("/");
  if (!owner || !repo) throw new GitError("Nama repository tidak valid.", 400);
  return [owner, repo] as const;
}

const github: GitHost = {
  id: "github",
  label: "GitHub",
  async listOwnedPublicRepos(a) {
    const repos = await gh.listPublicRepos(a.login);
    return repos.filter((r) => String(r.owner.id) === a.providerAccountId).map(fromGh);
  },
  getRepo: async (path) => fromGh(await gh.getRepo(...splitGh(path))),
  getRepoById: async (id) => fromGh(await gh.getRepoById(id)),
  listBranches: (path) => gh.listBranches(...splitGh(path)),
  async snapshot(path, branch) {
    const s = await gh.getSnapshot(...splitGh(path), branch);
    return {
      commitSha: s.commitSha,
      files: s.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, sha: t.sha })),
      hasSubmodules: s.tree.some((t) => t.type === "commit"),
      truncated: s.truncated,
    };
  },
  readFile: (path, ref, file) => gh.getFileText(...splitGh(path), ref, file),
  cloneUrl: (path) => `https://github.com/${path}.git`,
  treeUrl: (path, branch) => `https://github.com/${path}/tree/${branch}`,
  compareUrl: (path, from, to) => `https://github.com/${path}/compare/${from}...${to}`,
  commitsUrl: (path, branch) => `https://github.com/${path}/commits/${branch}`,
};

/* ---------- GitLab ---------- */

async function fromGl(p: GlProject): Promise<RepoInfo> {
  let ownerId: string | null = null;
  if (p.namespace.kind === "user") {
    // Field owner tidak selalu ada untuk request tanpa token; cari lewat username namespace.
    ownerId = p.owner ? String(p.owner.id) : String((await gitlab.userByUsername(p.namespace.path))?.id ?? "") || null;
  }
  return {
    id: p.id,
    path: p.path_with_namespace,
    name: p.path,
    ownerId,
    // API publik hanya mengembalikan project yang bisa dibaca tanpa login; selain "public" dianggap privat.
    private: (p.visibility ?? "public") !== "public",
    archived: !!p.archived,
    defaultBranch: p.default_branch ?? "main",
    description: p.description,
  };
}

const gitlabHost: GitHost = {
  id: "gitlab",
  label: "GitLab",
  async listOwnedPublicRepos(a) {
    const list = await gitlab.userProjects(a.providerAccountId);
    return Promise.all(list.filter((p) => !p.archived && p.default_branch).map(fromGl));
  },
  getRepo: async (path) => fromGl(await gitlab.project(path)),
  getRepoById: async (id) => fromGl(await gitlab.project(id)),
  listBranches: async (path) => (await gitlab.branches(path)).map((b) => b.name),
  async snapshot(path, branch) {
    const b = await gitlab.branch(path, branch);
    const t = await gitlab.tree(path, b.commit.id);
    return {
      commitSha: b.commit.id,
      files: t.entries.filter((e) => e.type === "blob").map((e) => ({ path: e.path, sha: e.id })),
      hasSubmodules: t.entries.some((e) => e.type === "commit"),
      truncated: t.truncated,
    };
  },
  readFile: (path, ref, file) => gitlab.rawFile(path, ref, file),
  cloneUrl: (path) => `${gitlabUrl()}/${path}.git`,
  treeUrl: (path, branch) => `${gitlabUrl()}/${path}/-/tree/${branch}`,
  compareUrl: (path, from, to) => `${gitlabUrl()}/${path}/-/compare/${from}...${to}`,
  commitsUrl: (path, branch) => `${gitlabUrl()}/${path}/-/commits/${branch}`,
};

export const gitHosts: Record<GitProvider, GitHost> = { github, gitlab: gitlabHost };

export function gitHost(provider: string): GitHost {
  const h = gitHosts[provider as GitProvider];
  if (!h) throw new GitError("Provider tidak didukung.", 400);
  return h;
}

/** owner/repo (GitHub) atau namespace bertingkat (GitLab), tiap bagian huruf/angka/._- */
const REPO_PATH_RE = /^[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100}){1,6}$/;

export function isValidRepoPath(provider: GitProvider, path: string) {
  if (!REPO_PATH_RE.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((p) => p === "." || p === "..")) return false;
  return provider === "github" ? parts.length === 2 : true;
}
