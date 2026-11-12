import "server-only";
import { createHash } from "node:crypto";
import { getRepo, getSnapshot, getFileText, GitHubError, type TreeEntry } from "./github";
import type { Framework } from "./schema";

export type PreflightResult = {
  ok: boolean;
  framework: Framework | null;
  frameworkLabel: string | null;
  outputDir: string | null;
  buildCommand: string | null;
  packageManager: "npm" | "pnpm" | null;
  /** ID numerik repository di GitHub (tetap walau repo/pemilik ganti nama). */
  repoId: number | null;
  /** Commit yang diperiksa. */
  commitSha: string | null;
  /** Hash file yang menentukan perintah build; null bila tidak bisa dihitung lengkap. */
  fingerprint: string | null;
  errors: string[];
  warnings: string[];
};

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  HTML: "HTML statis",
  VITE: "Vite",
  ASTRO: "Astro",
  NEXT_EXPORT: "Next.js static export",
  NUXT: "Nuxt generate",
  SVELTEKIT: "SvelteKit static",
};

export const BRANCH_RE = /^[a-zA-Z0-9._\-/]{1,100}$/;
export const REPO_PART_RE = /^[a-zA-Z0-9._-]{1,100}$/;

const BACKEND_DEPS = [
  "express", "fastify", "koa", "@nestjs/core", "hapi", "@hapi/hapi", "socket.io",
  "pg", "mysql", "mysql2", "mongoose", "mongodb", "prisma", "@prisma/client", "sequelize",
  "typeorm", "sqlite3", "better-sqlite3", "next-auth", "@supabase/ssr",
];

/** Spesifikasi dependency yang bukan dari npm registry resmi. */
function isForeignSpec(spec: string): boolean {
  return /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:|npm:)/i.test(spec) ||
    /^[\w-]+\/[\w.-]+(#.*)?$/.test(spec); // shorthand user/repo
}

function fail(errors: string[], warnings: string[] = []): PreflightResult {
  return {
    ok: false, framework: null, frameworkLabel: null, outputDir: null,
    buildCommand: null, packageManager: null, repoId: null, commitSha: null, fingerprint: null, errors, warnings,
  };
}

/**
 * File yang ikut menentukan apa yang dijalankan saat install/build: manifest & lockfile,
 * konfigurasi npm/pnpm/nixpacks, file *.config.* dan *rc.js (dieksekusi oleh tool build),
 * script di root dan folder scripts/. Perubahan di sini menahan auto-deploy sampai admin meninjau.
 */
const BUILD_FILE_RE = new RegExp(
  [
    String.raw`(^|/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?)$`,
    String.raw`(^|/)(\.npmrc|\.pnpmfile\.cjs|\.yarnrc(\.yml)?|\.nvmrc|\.node-version|\.tool-versions)$`,
    String.raw`(^|/)(nixpacks\.(toml|json)|Procfile|Dockerfile|railpack\.json|\.env[^/]*)$`,
    String.raw`(^|/)[^/]+\.config\.[cm]?[jt]sx?$`,
    String.raw`(^|/)[^/]+\.config\.json$`,
    String.raw`(^|/)\.[^/]+rc\.[cm]?[jt]s$`,
    String.raw`^[^/]+\.[cm]?[jt]s$`,
    String.raw`^scripts/`,
  ].join("|"),
);

export function isBuildFile(path: string) {
  return BUILD_FILE_RE.test(path);
}

export function fingerprintTree(tree: TreeEntry[], truncated: boolean): string | null {
  if (truncated) return null;
  const lines = tree
    .filter((t) => t.type === "blob" && isBuildFile(t.path))
    .map((t) => `${t.path}\0${t.sha}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Fingerprint file build pada HEAD branch saat ini. */
export async function currentFingerprint(owner: string, repo: string, branch: string) {
  const snap = await getSnapshot(owner, repo, branch);
  return { commitSha: snap.commitSha, fingerprint: fingerprintTree(snap.tree, snap.truncated) };
}

export async function runPreflight(
  owner: string,
  repo: string,
  branch: string,
  opts: { ownerId?: number } = {},
): Promise<PreflightResult> {
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(repo)) return fail(["Nama repository tidak valid."]);
  if (!BRANCH_RE.test(branch)) return fail(["Nama branch hanya boleh huruf, angka, titik, garis bawah, strip, dan garis miring."]);

  const errors: string[] = [];
  const warnings: string[] = [];

  let repoId: number;
  try {
    const info = await getRepo(owner, repo);
    if (info.private) return fail(["Repository harus public."]);
    if (opts.ownerId !== undefined && info.owner.id !== opts.ownerId) {
      return fail(["Repository ini bukan milik akun GitHub-mu."]);
    }
    repoId = info.id;
  } catch (e) {
    return fail([e instanceof GitHubError ? e.message : "Gagal menghubungi GitHub."]);
  }

  let snap;
  try {
    snap = await getSnapshot(owner, repo, branch);
  } catch (e) {
    return fail([e instanceof GitHubError ? e.message : "Gagal membaca isi repository."]);
  }
  const tree = snap;
  const commitSha = snap.commitSha;
  const fingerprint = fingerprintTree(snap.tree, snap.truncated);
  if (snap.truncated) {
    warnings.push("Repository terlalu besar untuk diperiksa penuh; setiap update akan menunggu tinjauan admin.");
  }
  // Baca file dari commit yang sama dengan daftar file di atas.
  const read = (path: string) => getFileText(owner, repo, commitSha, path);

  const files = new Set(tree.tree.filter((t) => t.type === "blob").map((t) => t.path));
  const rootFiles = [...files].filter((p) => !p.includes("/"));
  const has = (p: string) => files.has(p);

  if (tree.tree.some((t) => t.type === "commit")) {
    warnings.push("Repository memakai git submodule; submodule tidak ikut di-clone.");
  }

  // Tolak jenis project yang jelas bukan situs statis.
  if (has("composer.json") || rootFiles.some((f) => f.endsWith(".php")) || has("wp-config.php")) {
    return fail(["Project PHP, Laravel, atau WordPress belum didukung. Hanya website statis yang bisa dipublish."]);
  }
  if (has("requirements.txt") || has("go.mod") || has("Gemfile") || has("pom.xml") || has("Cargo.toml")) {
    errors.push("Terdeteksi file backend (Python/Go/Ruby/Java/Rust). Hanya website statis yang bisa dipublish.");
  }

  // HTML statis murni.
  if (!has("package.json")) {
    if (!has("index.html")) {
      return fail([...errors, "Tidak ada index.html di root repository dan tidak ada package.json."], warnings);
    }
    return {
      ok: errors.length === 0, framework: "HTML", frameworkLabel: FRAMEWORK_LABEL.HTML,
      outputDir: ".", buildCommand: null, packageManager: null, repoId, commitSha, fingerprint, errors, warnings,
    };
  }

  // Project Node.
  const lockNpm = has("package-lock.json");
  const lockPnpm = has("pnpm-lock.yaml");
  if (has("yarn.lock") || has("bun.lockb") || has("bun.lock")) {
    errors.push("Gunakan npm atau pnpm. Hapus yarn.lock / bun.lock lalu commit package-lock.json atau pnpm-lock.yaml.");
  }
  if (lockNpm && lockPnpm) errors.push("Ada dua lockfile. Simpan salah satu saja: package-lock.json atau pnpm-lock.yaml.");
  if (!lockNpm && !lockPnpm) errors.push("Lockfile belum di-commit. Jalankan npm install (atau pnpm install) lalu commit lockfile-nya.");
  const packageManager = lockPnpm && !lockNpm ? "pnpm" : "npm";

  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    const raw = await read("package.json");
    pkg = JSON.parse(raw ?? "{}");
  } catch {
    return fail([...errors, "package.json tidak bisa dibaca sebagai JSON yang valid."], warnings);
  }

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};

  const foreign = Object.entries(deps).filter(([, spec]) => typeof spec === "string" && isForeignSpec(spec));
  if (foreign.length) {
    errors.push(
      `Dependency harus dari npm registry resmi. Ganti: ${foreign.map(([n]) => n).slice(0, 5).join(", ")}.`,
    );
  }
  if ("react-scripts" in deps) {
    return fail([...errors, "Create React App (react-scripts) belum didukung. Pindahkan project ke Vite."], warnings);
  }
  const backend = BACKEND_DEPS.filter((d) => d in (pkg.dependencies ?? {}));
  if (backend.length) {
    warnings.push(`Dependency server terdeteksi (${backend.join(", ")}). Bagian server tidak akan berjalan di hosting statis.`);
  }

  const run = (script: string) => (packageManager === "pnpm" ? `pnpm run ${script}` : `npm run ${script}`);
  let framework: Framework | null = null;
  let outputDir: string | null = null;
  let buildCommand: string | null = null;

  if ("next" in deps) {
    framework = "NEXT_EXPORT";
    outputDir = "out";
    const cfgPath = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].find(has);
    const cfg = cfgPath ? await read(cfgPath) : null;
    if (!cfg || !/output\s*:\s*["']export["']/.test(cfg)) {
      errors.push("Next.js wajib memakai output: 'export' di next.config.");
    }
    if (!scripts.build) errors.push("Tambahkan script \"build\": \"next build\" di package.json.");
    buildCommand = run("build");
  } else if ("nuxt" in deps) {
    framework = "NUXT";
    outputDir = ".output/public";
    if (!scripts.generate) errors.push("Tambahkan script \"generate\": \"nuxt generate\" di package.json.");
    buildCommand = run("generate");
  } else if ("@sveltejs/kit" in deps) {
    framework = "SVELTEKIT";
    outputDir = "build";
    if (!("@sveltejs/adapter-static" in deps)) errors.push("SvelteKit wajib memakai @sveltejs/adapter-static.");
    if (!scripts.build) errors.push("Tambahkan script \"build\" di package.json.");
    buildCommand = run("build");
  } else if ("astro" in deps) {
    framework = "ASTRO";
    outputDir = "dist";
    if (!scripts.build) errors.push("Tambahkan script \"build\": \"astro build\" di package.json.");
    const cfgPath = ["astro.config.mjs", "astro.config.ts", "astro.config.js"].find(has);
    const cfg = cfgPath ? await read(cfgPath) : null;
    if (cfg && /output\s*:\s*["'](server|hybrid)["']/.test(cfg)) errors.push("Astro harus memakai output static (bukan server/hybrid).");
    buildCommand = run("build");
  } else if ("vite" in deps) {
    framework = "VITE";
    outputDir = "dist";
    if (!scripts.build) errors.push("Tambahkan script \"build\": \"vite build\" di package.json.");
    buildCommand = run("build");
  } else if (has("index.html")) {
    framework = "HTML";
    outputDir = ".";
    warnings.push("package.json ada tapi tidak ada framework yang dikenali; dipublish sebagai HTML statis apa adanya.");
  } else {
    errors.push("Framework tidak dikenali. Didukung: HTML statis, Vite, Astro, Next.js export, Nuxt generate, SvelteKit static.");
  }

  return {
    ok: errors.length === 0 && framework !== null,
    framework,
    frameworkLabel: framework ? FRAMEWORK_LABEL[framework] : null,
    outputDir,
    buildCommand,
    packageManager: framework === "HTML" ? null : packageManager,
    repoId,
    commitSha,
    fingerprint,
    errors,
    warnings,
  };
}
