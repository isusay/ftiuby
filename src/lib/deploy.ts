import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { accounts, projects, uploads, type GitProvider, type Project } from "./schema";
import { dokploy, DokployError, type BuildConfig } from "./dokploy";
import { GitError, gitHost, type RepoInfo } from "./git";
import { currentFingerprint, runPreflight, type PreflightResult } from "./preflight";
import { inspectStoredZip } from "./archive";

export function siteUrl(slug: string) {
  return `https://${slug}.${env.sitesDomain}`;
}

export type GitProject = Project & { provider: GitProvider; repoPath: string; branch: string };

export function isGitProject(p: Project): p is GitProject {
  return p.provider !== "drop" && !!p.repoPath && !!p.branch;
}

/** Label sumber untuk ditampilkan: "GitHub · alice/web@main" atau "Upload ZIP". */
export function sourceLabel(p: Project) {
  return isGitProject(p) ? `${gitHost(p.provider).label} · ${p.repoPath}@${p.branch}` : "Upload ZIP";
}

/** Link ke kode sumber di provider (null untuk upload ZIP). */
export function sourceUrl(p: Project) {
  return isGitProject(p) ? gitHost(p.provider).treeUrl(p.repoPath, p.branch) : null;
}

function buildConfigFor(p: Project): BuildConfig {
  if (p.framework === "HTML") return { kind: "static" };
  return { kind: "nixpacks", publishDirectory: p.outputDir, isStaticSpa: p.framework === "VITE" };
}

function buildEnvFor(p: Project): string {
  if (p.framework === "HTML") return "";
  const lines = ["NIXPACKS_NODE_VERSION=22", "NODE_ENV=production"];
  if (p.buildCommand) lines.push(`NIXPACKS_BUILD_CMD=${p.buildCommand}`);
  if (p.framework === "NEXT_EXPORT") lines.push("NEXT_TELEMETRY_DISABLED=1");
  if (p.framework === "ASTRO") lines.push("ASTRO_TELEMETRY_DISABLED=1");
  return lines.join("\n");
}

/**
 * Dipanggil saat admin menyetujui/meninjau: buat aplikasi di Dokploy bila belum ada,
 * pasang domain nama.ftiuby.cloud, simpan sumber (repo git atau ZIP) & tipe build, lalu deploy.
 */
export async function provisionProject(p: Project, title = "Deploy pertama setelah disetujui") {
  let appId = p.dokployAppId;
  if (!appId) {
    const app = await dokploy.createApplication(
      `${p.slug}`,
      `site-${p.slug}`.slice(0, 63),
      `ftiuby: ${sourceLabel(p)}`.slice(0, 200),
    );
    appId = app.applicationId;
    await db.update(projects).set({ dokployAppId: appId }).where(eq(projects.id, p.id));

    try {
      await dokploy.createDomain(appId, `${p.slug}.${env.sitesDomain}`);
    } catch (e) {
      // Domain sudah ada (misal provisioning diulang) tidak dianggap fatal.
      if (!(e instanceof DokployError) || !/exist|already/i.test(e.message)) throw e;
    }
  }

  if (isGitProject(p)) {
    await dokploy.saveGitProvider(appId, gitHost(p.provider).cloneUrl(p.repoPath), p.branch);
  }
  await dokploy.saveBuildType(appId, buildConfigFor(p));
  await dokploy.saveEnvironment(appId, buildEnvFor(p));
  await dokploy.setLimits(appId);
  await triggerDeploy({ ...p, dokployAppId: appId }, title);
}

/** Jalankan deploy di Dokploy: git → tarik branch; drop → kirim ZIP yang sudah ditinjau (uploadId). */
export async function triggerDeploy(p: Project, title: string) {
  if (!p.dokployAppId) throw new Error("Project belum terhubung ke Dokploy.");
  if (isGitProject(p)) {
    await dokploy.deploy(p.dokployAppId, title);
  } else {
    if (!p.uploadId) throw new Error("Project belum punya file ZIP.");
    const up = await db.query.uploads.findFirst({ where: eq(uploads.id, p.uploadId) });
    if (!up) throw new Error("File ZIP project tidak ditemukan.");
    await dokploy.dropDeploy(p.dokployAppId, up.data, `${p.slug}.zip`);
  }
  await db
    .update(projects)
    .set({ deployState: "queued", lastDeployAt: new Date() })
    .where(eq(projects.id, p.id));
}

/* ---------- Identitas repo & gerbang review ---------- */

export class RepoAccessError extends Error {}

/**
 * Pastikan repo project masih ada, public, dan dimiliki akun provider yang terhubung ke pemilik
 * project (dicek lewat ID numerik, bukan username). Cache repoPath diperbarui bila repo atau
 * pemiliknya ganti nama.
 */
export async function resolveProjectRepo(p: GitProject): Promise<GitProject> {
  const host = gitHost(p.provider);
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, p.userId), eq(accounts.provider, p.provider)),
  });
  if (!account) throw new RepoAccessError(`Akun ${host.label} pemilik project sudah tidak terhubung.`);

  let info: RepoInfo;
  try {
    info = p.repoId ? await host.getRepoById(p.repoId) : await host.getRepo(p.repoPath);
  } catch (e) {
    if (e instanceof GitError && e.status === 404) {
      throw new RepoAccessError("Repository tidak ditemukan atau sudah tidak public.");
    }
    throw e;
  }
  if (info.private) throw new RepoAccessError("Repository sudah tidak public.");
  if (info.ownerId !== account.providerAccountId) {
    throw new RepoAccessError(`Repository ${info.path} bukan lagi milik @${account.login} di ${host.label}.`);
  }
  if (info.id === p.repoId && info.path === p.repoPath) return p;

  const [updated] = await db
    .update(projects)
    .set({ repoId: info.id, repoPath: info.path })
    .where(eq(projects.id, p.id))
    .returning();
  return (updated ?? p) as GitProject;
}

/**
 * Tinjauan admin: periksa sumber yang akan dipublish.
 * Git → verifikasi kepemilikan lalu preflight isi branch saat ini.
 * Drop → preflight ZIP yang menunggu (pendingUploadId), atau ZIP saat ini.
 */
export async function reviewSource(p: Project): Promise<{ project: Project; pf: PreflightResult; uploadId: string | null }> {
  if (isGitProject(p)) {
    const project = await resolveProjectRepo(p);
    const pf = await runPreflight(project.provider, project.repoPath, project.branch);
    if (pf.ok && pf.repoId !== project.repoId) {
      pf.ok = false;
      pf.errors.push("Repository berubah saat diperiksa. Coba lagi.");
    }
    return { project, pf, uploadId: null };
  }
  const uploadId = p.pendingUploadId ?? p.uploadId;
  const up = uploadId ? await db.query.uploads.findFirst({ where: eq(uploads.id, uploadId) }) : null;
  if (!up) throw new RepoAccessError("File ZIP project tidak ditemukan. Minta developer mengunggah ulang.");
  return { project: p, pf: await inspectStoredZip(up.data), uploadId: up.id };
}

/** Kolom project yang diperbarui setelah admin meninjau sumber. */
export function reviewedFields(pf: PreflightResult, uploadId: string | null) {
  return {
    framework: pf.framework!,
    outputDir: pf.outputDir!,
    buildCommand: pf.buildCommand,
    packageManager: pf.packageManager,
    ...(pf.repoId ? { repoId: pf.repoId } : {}),
    ...(uploadId ? { uploadId, pendingUploadId: null } : {}),
    reviewedFingerprint: pf.fingerprint,
    reviewedCommit: pf.commitSha,
    reviewHeldAt: null,
    reviewHeldReason: null,
  } satisfies Partial<Project>;
}

export type DeployOutcome = { deployed: true } | { held: true; reason: string };

async function hold(p: Project, reason: string, extra: Partial<Project> = {}): Promise<DeployOutcome> {
  await db
    .update(projects)
    .set({ reviewHeldAt: p.reviewHeldAt ?? new Date(), reviewHeldReason: reason, ...extra })
    .where(eq(projects.id, p.id));
  return { held: true, reason };
}

const CHANGED = "File build (package.json, lockfile, atau file konfigurasi) berubah sejak terakhir ditinjau.";

/**
 * Apakah perubahan boleh di-deploy tanpa admin? Kode di-build di server kita, jadi hanya bila
 * file yang menentukan install/build sama persis dengan yang terakhir ditinjau.
 * HTML statis disajikan Nginx apa adanya tanpa menjalankan kode, jadi selalu aman.
 */
function gateReason(p: Project, framework: Project["framework"], fingerprint: string | null): string | null {
  if (p.framework === "HTML" && framework === "HTML") return null;
  if (framework !== p.framework) return "Jenis framework berubah sejak terakhir ditinjau.";
  if (!p.reviewedFingerprint) return "Project ini belum punya data tinjauan file build. Admin perlu meninjau sekali.";
  if (!fingerprint) return "Sumber kode terlalu besar untuk diperiksa otomatis.";
  if (fingerprint !== p.reviewedFingerprint) return CHANGED;
  return null;
}

/**
 * Deploy repo git yang dipicu developer (push webhook / tombol Build ulang).
 * Jika file build berubah, update ditahan dan muncul di tab "Update tertahan" admin.
 */
export async function guardedDeploy(p: Project, title: string): Promise<DeployOutcome> {
  if (!p.dokployAppId) throw new Error("Project belum terhubung ke Dokploy.");
  if (!isGitProject(p)) throw new Error("Project ini bersumber dari upload ZIP.");
  if (p.reviewHeldAt) return { held: true, reason: p.reviewHeldReason ?? "Update menunggu tinjauan admin." };

  let fresh: GitProject;
  try {
    fresh = await resolveProjectRepo(p);
  } catch (e) {
    if (e instanceof RepoAccessError) return hold(p, e.message);
    throw e;
  }

  if (fresh.framework !== "HTML") {
    const { fingerprint } = await currentFingerprint(fresh.provider, fresh.repoPath, fresh.branch);
    const reason = gateReason(fresh, fresh.framework, fingerprint);
    if (reason) return hold(fresh, reason);
  }

  if (fresh.repoPath !== p.repoPath) {
    await dokploy.saveGitProvider(fresh.dokployAppId!, gitHost(fresh.provider).cloneUrl(fresh.repoPath), fresh.branch);
  }
  await triggerDeploy(fresh, title);
  return { deployed: true };
}

/**
 * Developer mengunggah ZIP versi baru untuk project drop yang sudah tayang.
 * Lolos gerbang → langsung di-deploy; tidak → disimpan sebagai pendingUploadId untuk ditinjau admin.
 */
export async function deployNewUpload(p: Project, uploadId: string, pf: PreflightResult): Promise<DeployOutcome> {
  if (!p.dokployAppId) throw new Error("Project belum terhubung ke Dokploy.");
  const reason = p.reviewHeldAt ? (p.reviewHeldReason ?? CHANGED) : gateReason(p, pf.framework!, pf.fingerprint);
  if (reason) return hold(p, reason, { pendingUploadId: uploadId });

  const [updated] = await db
    .update(projects)
    .set({ uploadId, pendingUploadId: null })
    .where(eq(projects.id, p.id))
    .returning();
  await triggerDeploy(updated, "Upload ZIP baru");
  return { deployed: true };
}

/** Hapus ZIP milik user yang tidak lagi dipakai project mana pun. */
export async function pruneUploads(userId: string) {
  const refs = await db
    .select({ a: projects.uploadId, b: projects.pendingUploadId })
    .from(projects)
    .where(eq(projects.userId, userId));
  const keep = refs.flatMap((r) => [r.a, r.b]).filter((x): x is string => !!x);
  await db
    .delete(uploads)
    .where(keep.length ? and(eq(uploads.userId, userId), notInArray(uploads.id, keep)) : eq(uploads.userId, userId));
}

/**
 * Sinkronkan status build dari Dokploy ke database.
 * "done"/"error" baru dipercaya setelah status "running" pernah terlihat
 * (atau 3 menit berlalu), supaya status deploy sebelumnya tidak terbaca sebagai hasil baru.
 */
export async function syncProject(p: Project): Promise<Project> {
  if (!p.dokployAppId || !["BUILDING", "LIVE", "FAILED"].includes(p.status)) return p;
  if (p.deployState !== "queued" && p.deployState !== "running") return p;

  let state: string;
  try {
    state = (await dokploy.getApplication(p.dokployAppId)).applicationStatus;
  } catch {
    return p;
  }

  const sinceDeploy = p.lastDeployAt ? Date.now() - p.lastDeployAt.getTime() : Infinity;
  const settled = p.deployState === "running" || sinceDeploy > 180_000;
  const patch: Partial<Project> = {};

  if (state === "running") {
    patch.deployState = "running";
  } else if (state === "done" && settled) {
    patch.deployState = "done";
    if (p.status !== "LIVE") {
      patch.status = "LIVE";
      patch.liveAt = p.liveAt ?? new Date();
    }
  } else if (state === "error" && settled) {
    patch.deployState = "error";
    // Kalau pernah live, versi lama tetap melayani; status tetap LIVE.
    if (!p.liveAt) patch.status = "FAILED";
  }

  if (Object.keys(patch).length === 0) return p;
  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, p.id)).returning();
  return updated ?? p;
}

/** Matikan situs dan bebaskan resource di Dokploy. Riwayat project tetap tersimpan. */
export async function archiveProject(p: Project) {
  if (p.dokployAppId) {
    try {
      await dokploy.delete(p.dokployAppId);
    } catch (e) {
      if (!(e instanceof DokployError) || e.status !== 404) throw e;
    }
  }
  await db
    .update(projects)
    .set({
      status: "ARCHIVED",
      dokployAppId: null,
      deployState: null,
      liveAt: null,
      reviewHeldAt: null,
      reviewHeldReason: null,
      pendingUploadId: null,
    })
    .where(eq(projects.id, p.id));
  if (p.provider === "drop") await pruneUploads(p.userId);
}
