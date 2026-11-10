import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { projects, type Project } from "./schema";
import { dokploy, DokployError, type BuildConfig } from "./dokploy";

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
export async function provisionProject(p: Project) {
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
  await triggerDeploy({ ...p, dokployAppId: appId }, "Deploy pertama setelah disetujui");
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
    .set({ status: "ARCHIVED", dokployAppId: null, deployState: null, liveAt: null })
    .where(eq(projects.id, p.id));
}
