import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { projects, users, type Project } from "./schema";
import { dokploy, DokployError, type BuildConfig } from "./dokploy";
import { getRepo, getRepoById, GitHubError, type GhRepo } from "./github";
import { currentFingerprint, runPreflight, type PreflightResult } from "./preflight";

export function siteUrl(slug: string) {
  return `https://${slug}.${env.sitesDomain}`;
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
 * Dipanggil saat admin menyetujui: buat aplikasi di Dokploy, hubungkan repo,
 * pasang domain nama.ftiuby.cloud, lalu jalankan deploy pertama.
 */
export async function provisionProject(p: Project, title = "Deploy pertama setelah disetujui") {
  let appId = p.dokployAppId;
  if (!appId) {
    const app = await dokploy.createApplication(
      `${p.slug} (${p.repoOwner})`,
      `site-${p.slug}`.slice(0, 63),
      `ftiuby: ${p.repoOwner}/${p.repoName}@${p.branch}`,
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

  await dokploy.saveGitProvider(appId, `https://github.com/${p.repoOwner}/${p.repoName}.git`, p.branch);
  await dokploy.saveBuildType(appId, buildConfigFor(p));
  await dokploy.saveEnvironment(appId, buildEnvFor(p));
  await dokploy.setLimits(appId);
  await triggerDeploy({ ...p, dokployAppId: appId }, title);
}

/* ---------- Identitas repo & gerbang review ---------- */

export class RepoAccessError extends Error {}

/**
 * Pastikan repo project masih ada, public, dan dimiliki akun GitHub pemilik project
 * (dicek lewat ID numerik, bukan username). Cache repoOwner/repoName diperbarui bila
 * repo atau pemiliknya ganti nama.
 */
export async function resolveProjectRepo(p: Project): Promise<Project> {
  const owner = await db.query.users.findFirst({ where: eq(users.id, p.userId) });
  if (!owner) throw new RepoAccessError("Pemilik project tidak ditemukan.");

  let info: GhRepo;
  try {
    info = p.repoId ? await getRepoById(p.repoId) : await getRepo(p.repoOwner, p.repoName);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      throw new RepoAccessError("Repository tidak ditemukan atau sudah tidak public.");
    }
    throw e;
  }
  if (info.private) throw new RepoAccessError("Repository sudah tidak public.");
  if (info.owner.id !== owner.githubId) {
    throw new RepoAccessError(`Repository ${info.full_name} bukan lagi milik @${owner.login}.`);
  }
  if (info.id === p.repoId && info.owner.login === p.repoOwner && info.name === p.repoName) return p;

  const [updated] = await db
    .update(projects)
    .set({ repoId: info.id, repoOwner: info.owner.login, repoName: info.name })
    .where(eq(projects.id, p.id))
    .returning();
  return updated ?? p;
}

/**
 * Tinjauan admin: verifikasi kepemilikan repo lalu jalankan preflight pada isi branch saat ini.
 * Hasilnya (termasuk fingerprint) disimpan oleh pemanggil sebagai versi yang sudah ditinjau.
 */
export async function reviewRepo(p: Project): Promise<{ project: Project; pf: PreflightResult }> {
  const project = await resolveProjectRepo(p);
  const pf = await runPreflight(project.repoOwner, project.repoName, project.branch);
  if (pf.ok && pf.repoId !== project.repoId) {
    pf.ok = false;
    pf.errors.push("Repository berubah saat diperiksa. Coba lagi.");
  }
  return { project, pf };
}

/** Kolom project yang diperbarui dari hasil tinjauan. */
export function reviewedFields(pf: PreflightResult) {
  return {
    framework: pf.framework!,
    outputDir: pf.outputDir!,
    buildCommand: pf.buildCommand,
    packageManager: pf.packageManager,
    repoId: pf.repoId,
    reviewedFingerprint: pf.fingerprint,
    reviewedCommit: pf.commitSha,
    reviewHeldAt: null,
    reviewHeldReason: null,
  } satisfies Partial<Project>;
}

export type DeployOutcome = { deployed: true } | { held: true; reason: string };

async function hold(p: Project, reason: string): Promise<DeployOutcome> {
  await db
    .update(projects)
    .set({ reviewHeldAt: p.reviewHeldAt ?? new Date(), reviewHeldReason: reason })
    .where(eq(projects.id, p.id));
  return { held: true, reason };
}

/**
 * Deploy yang dipicu developer (push webhook / tombol Build ulang).
 * Kode di-build di server kita, jadi deploy hanya jalan otomatis bila file yang menentukan
 * proses install/build sama persis dengan versi yang terakhir ditinjau admin.
 * Jika berbeda, update ditahan dan muncul di tab "Tertahan" admin.
 */
export async function guardedDeploy(p: Project, title: string): Promise<DeployOutcome> {
  if (!p.dokployAppId) throw new Error("Project belum terhubung ke Dokploy.");
  if (p.reviewHeldAt) return { held: true, reason: p.reviewHeldReason ?? "Update menunggu tinjauan admin." };

  let fresh: Project;
  try {
    fresh = await resolveProjectRepo(p);
  } catch (e) {
    if (e instanceof RepoAccessError) return hold(p, e.message);
    throw e;
  }

  // HTML statis disajikan Nginx apa adanya tanpa menjalankan kode, jadi aman di-deploy otomatis.
  if (fresh.framework !== "HTML") {
    const { fingerprint } = await currentFingerprint(fresh.repoOwner, fresh.repoName, fresh.branch);
    if (!fresh.reviewedFingerprint) {
      return hold(fresh, "Project ini belum punya data tinjauan file build. Admin perlu meninjau sekali.");
    }
    if (!fingerprint) {
      return hold(fresh, "Repository terlalu besar untuk diperiksa otomatis.");
    }
    if (fingerprint !== fresh.reviewedFingerprint) {
      return hold(fresh, "File build (package.json, lockfile, atau file konfigurasi) berubah sejak terakhir ditinjau.");
    }
  }

  if (fresh.repoOwner !== p.repoOwner || fresh.repoName !== p.repoName) {
    await dokploy.saveGitProvider(fresh.dokployAppId!, `https://github.com/${fresh.repoOwner}/${fresh.repoName}.git`, fresh.branch);
  }
  await triggerDeploy(fresh, title);
  return { deployed: true };
}

export async function triggerDeploy(p: Pick<Project, "id" | "dokployAppId">, title: string) {
  if (!p.dokployAppId) throw new Error("Project belum terhubung ke Dokploy.");
  await dokploy.deploy(p.dokployAppId, title);
  await db
    .update(projects)
    .set({ deployState: "queued", lastDeployAt: new Date() })
    .where(eq(projects.id, p.id));
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
    .set({ status: "ARCHIVED", dokployAppId: null, deployState: null, liveAt: null, reviewHeldAt: null, reviewHeldReason: null })
    .where(eq(projects.id, p.id));
}
