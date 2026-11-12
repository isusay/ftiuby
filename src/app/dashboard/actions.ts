"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne, sql, isNull, or, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { accounts, invites, projects, uploads, users, GIT_PROVIDERS, type GitProvider, type User } from "@/lib/schema";
import { AuthError, requireActiveUser, requireUser } from "@/lib/session";
import { GitError, gitHost, isValidRepoPath } from "@/lib/git";
import { runPreflight, BRANCH_RE, type PreflightResult } from "@/lib/preflight";
import { ArchiveError, MAX_ZIP_BYTES, prepareUpload, type PreparedUpload } from "@/lib/archive";
import { normalizeSlug, slugProblem } from "@/lib/slug";
import { randomSecret } from "@/lib/id";
import {
  archiveProject, deployNewUpload, guardedDeploy, isGitProject, pruneUploads, resolveProjectRepo,
  RepoAccessError, triggerDeploy,
} from "@/lib/deploy";
import { syncUserFromAccounts } from "@/lib/auth-flow";
import { CATEGORIES, projectQuota, slotStats } from "@/lib/queries";

export type FormState = { error?: string; ok?: string } | null;

function errMsg(e: unknown) {
  if (e instanceof AuthError || e instanceof GitError || e instanceof RepoAccessError || e instanceof ArchiveError) {
    return e.message;
  }
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Data tidak valid.";
  console.error(e);
  return "Terjadi kesalahan di server. Coba lagi sebentar lagi.";
}

/* ---------- Undangan ---------- */

export async function redeemInvite(_: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    if (user.activatedAt) return { ok: "Akunmu sudah aktif." };
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    if (!code) return { error: "Masukkan kode undangan." };

    const slots = await slotStats();
    if (slots.available <= 0) return { error: "Slot beta sedang penuh. Hubungi admin untuk info gelombang berikutnya." };

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [inv] = await tx
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(
          and(
            eq(invites.code, code),
            sql`${invites.uses} < ${invites.maxUses}`,
            or(isNull(invites.expiresAt), gt(invites.expiresAt, now)),
          ),
        )
        .returning({ id: invites.id });
      if (!inv) return false;
      await tx.update(users).set({ activatedAt: now, inviteId: inv.id }).where(eq(users.id, user.id));
      return true;
    });
    if (!result) return { error: "Kode tidak valid, sudah habis dipakai, atau kedaluwarsa." };
    revalidatePath("/dashboard");
    return { ok: "Akun aktif. Sekarang kamu bisa publish web." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/* ---------- Akun provider ---------- */

async function accountFor(user: User, provider: GitProvider) {
  const a = await db.query.accounts.findFirst({ where: and(eq(accounts.userId, user.id), eq(accounts.provider, provider)) });
  if (!a) throw new AuthError(`Hubungkan akun ${gitHost(provider).label} dulu.`);
  return a;
}

function parseProvider(v: unknown): GitProvider {
  const p = String(v);
  if (!(GIT_PROVIDERS as readonly string[]).includes(p)) throw new AuthError("Provider tidak dikenal.");
  return p as GitProvider;
}

export async function unlinkAccount(_: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    const provider = parseProvider(form.get("provider"));
    const [{ n }] = await db.select({ n: count() }).from(accounts).where(eq(accounts.userId, user.id));
    if (Number(n) <= 1) return { error: "Tidak bisa memutus satu-satunya akun login." };
    const inUse = await db.query.projects.findFirst({
      where: and(eq(projects.userId, user.id), eq(projects.provider, provider), ne(projects.status, "ARCHIVED")),
    });
    if (inUse) return { error: `Masih ada project aktif dari ${gitHost(provider).label}. Arsipkan dulu.` };
    await db.delete(accounts).where(and(eq(accounts.userId, user.id), eq(accounts.provider, provider)));
    await syncUserFromAccounts(user.id);
    revalidatePath("/dashboard");
    return { ok: `Akun ${gitHost(provider).label} diputus.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/* ---------- Repository & preflight ---------- */

export type RepoOption = { path: string; name: string; branch: string; description: string | null };

export async function loadRepos(provider: GitProvider): Promise<{ repos?: RepoOption[]; error?: string }> {
  try {
    const user = await requireActiveUser();
    const account = await accountFor(user, parseProvider(provider));
    const repos = await gitHost(provider).listOwnedPublicRepos(account);
    return {
      repos: repos.map((r) => ({ path: r.path, name: r.name, branch: r.defaultBranch, description: r.description })),
    };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function loadBranches(provider: GitProvider, path: string): Promise<{ branches?: string[]; error?: string }> {
  try {
    await requireActiveUser();
    if (!isValidRepoPath(parseProvider(provider), path)) return { error: "Nama repository tidak valid." };
    return { branches: await gitHost(provider).listBranches(path) };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function checkRepo(provider: GitProvider, path: string, branch: string): Promise<PreflightResult | { error: string }> {
  try {
    const user = await requireActiveUser();
    const account = await accountFor(user, parseProvider(provider));
    return await runPreflight(provider, path, branch, { ownerId: account.providerAccountId });
  } catch (e) {
    return { error: errMsg(e) };
  }
}

async function readZip(form: FormData, field = "zip"): Promise<PreparedUpload | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_ZIP_BYTES) throw new ArchiveError("File ZIP maksimal 25 MB.");
  return prepareUpload(new Uint8Array(await f.arrayBuffer()));
}

/** Pratinjau pemeriksaan ZIP sebelum dikirim (file tidak disimpan). */
export async function checkUpload(form: FormData): Promise<PreflightResult | { error: string }> {
  try {
    if (!env.dropEnabled) return { error: "Upload ZIP sedang dinonaktifkan." };
    await requireActiveUser();
    const up = await readZip(form);
    if (!up) return { error: "Pilih file ZIP." };
    return up.preflight;
  } catch (e) {
    return { error: errMsg(e) };
  }
}

async function storeUpload(userId: string, up: PreparedUpload, pf: PreflightResult) {
  const [row] = await db
    .insert(uploads)
    .values({ userId, data: up.zip, size: up.zip.byteLength, fileCount: up.fileCount, sha256: up.sha256, fingerprint: pf.fingerprint })
    .returning({ id: uploads.id });
  return row.id;
}

/* ---------- Kuota ---------- */

const QUOTA_FULL = "Kuota project aktifmu sudah penuh. Arsipkan salah satu, atau minta admin menambah kuota.";

/**
 * Jalankan perubahan yang menambah project aktif di dalam transaksi yang mengunci baris user,
 * sehingga dua pengajuan bersamaan tidak bisa melewati kuota.
 */
async function withQuota<T>(userId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    const [{ n }] = await tx
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.userId, userId), ne(projects.status, "ARCHIVED")));
    if (Number(n) >= (u.projectLimit ?? env.maxProjectsPerUser)) throw new AuthError(QUOTA_FULL);
    return fn(tx);
  });
}

/* ---------- Pengajuan ---------- */

const detailSchema = z.object({
  slug: z.string().min(1, "Isi nama subdomain."),
  title: z.string().trim().min(3, "Judul minimal 3 karakter.").max(60, "Judul maksimal 60 karakter."),
  description: z.string().trim().min(10, "Deskripsi minimal 10 karakter.").max(240, "Deskripsi maksimal 240 karakter."),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Pilih kategori." }) }),
});

export async function submitProject(_: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireActiveUser();
    const source = String(form.get("source") ?? "");
    const data = detailSchema.parse({
      slug: form.get("slug"),
      title: form.get("title"),
      description: form.get("description"),
      category: form.get("category"),
    });
    const slug = normalizeSlug(data.slug);
    const problem = slugProblem(slug);
    if (problem) return { error: problem };

    if ((await projectQuota(user)).available <= 0) return { error: QUOTA_FULL };

    const taken = await db.query.projects.findFirst({ where: eq(projects.slug, slug) });
    if (taken && taken.userId !== user.id) return { error: `Subdomain ${slug} sudah dipakai. Pilih nama lain.` };
    if (taken) return { error: `Subdomain ${slug} milik project lamamu. Pakai tombol "Ajukan lagi" di riwayat.` };

    const base = { slug, title: data.title, description: data.description, category: data.category, webhookSecret: randomSecret(), userId: user.id };

    if (source === "drop") {
      if (!env.dropEnabled) return { error: "Upload ZIP sedang dinonaktifkan." };
      const up = await readZip(form);
      if (!up) return { error: "Pilih file ZIP." };
      const pf = up.preflight;
      if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "ZIP belum lolos pemeriksaan." };
      await withQuota(user.id, async (tx) => {
        const [row] = await tx
          .insert(uploads)
          .values({ userId: user.id, data: up.zip, size: up.zip.byteLength, fileCount: up.fileCount, sha256: up.sha256, fingerprint: pf.fingerprint })
          .returning({ id: uploads.id });
        await tx.insert(projects).values({
          ...base,
          provider: "drop",
          uploadId: row.id,
          framework: pf.framework!,
          outputDir: pf.outputDir!,
          buildCommand: pf.buildCommand,
          packageManager: pf.packageManager,
        });
      });
    } else {
      const provider = parseProvider(source);
      const path = String(form.get("repo") ?? "");
      const branch = String(form.get("branch") ?? "");
      if (!isValidRepoPath(provider, path)) return { error: "Pilih repository." };
      if (!BRANCH_RE.test(branch)) return { error: "Pilih branch." };
      const account = await accountFor(user, provider);
      // Preflight diulang di server: hasil dari browser tidak dipercaya.
      const pf = await runPreflight(provider, path, branch, { ownerId: account.providerAccountId });
      if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "Repository belum lolos pemeriksaan." };
      await withQuota(user.id, (tx) =>
        tx.insert(projects).values({
          ...base,
          provider,
          repoPath: path,
          repoId: pf.repoId,
          branch,
          framework: pf.framework!,
          outputDir: pf.outputDir!,
          buildCommand: pf.buildCommand,
          packageManager: pf.packageManager,
        }),
      );
    }
    revalidatePath("/dashboard");
    return { ok: "Pengajuan terkirim. Admin akan meninjau project-mu." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

async function ownProject(id: string) {
  const user = await requireActiveUser();
  const p = await db.query.projects.findFirst({ where: and(eq(projects.id, id), eq(projects.userId, user.id)) });
  if (!p) throw new AuthError("Project tidak ditemukan.");
  return { user, p };
}

/** Kirim ulang setelah revisi, atau ajukan lagi project yang diarsipkan. */
export async function resubmitProject(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { user, p: own } = await ownProject(String(form.get("id")));
    if (own.status !== "NEEDS_REVISION" && own.status !== "ARCHIVED") return { error: "Project ini tidak sedang menunggu revisi." };

    let patch: Partial<typeof projects.$inferInsert>;
    if (isGitProject(own)) {
      const branch = String(form.get("branch") || own.branch);
      if (!BRANCH_RE.test(branch)) return { error: "Nama branch tidak valid." };
      const account = await accountFor(user, own.provider);
      // Pastikan repo masih milikmu (dicek lewat ID) dan pakai namanya yang terkini.
      const p = await resolveProjectRepo(own);
      const pf = await runPreflight(p.provider, p.repoPath, branch, { ownerId: account.providerAccountId });
      if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "Repository belum lolos pemeriksaan." };
      patch = { branch, framework: pf.framework, outputDir: pf.outputDir, buildCommand: pf.buildCommand, packageManager: pf.packageManager, repoId: pf.repoId };
    } else {
      const up = await readZip(form);
      if (!up && !own.uploadId) return { error: "Unggah file ZIP terbaru." };
      patch = {};
      if (up) {
        const pf = up.preflight;
        if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "ZIP belum lolos pemeriksaan." };
        patch = {
          uploadId: await storeUpload(user.id, up, pf),
          pendingUploadId: null,
          framework: pf.framework,
          outputDir: pf.outputDir,
          buildCommand: pf.buildCommand,
          packageManager: pf.packageManager,
        };
      }
    }

    const apply = (tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
      tx.update(projects).set({ ...patch, status: "SUBMITTED" }).where(eq(projects.id, own.id));
    if (own.status === "ARCHIVED") await withQuota(user.id, apply);
    else await apply(db);
    if (own.provider === "drop") await pruneUploads(user.id);
    revalidatePath("/dashboard");
    return { ok: "Pengajuan dikirim ulang." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function redeployProject(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { p } = await ownProject(String(form.get("id")));
    if (!["LIVE", "FAILED"].includes(p.status) || !p.dokployAppId) return { error: "Project belum disetujui admin." };
    if (p.lastDeployAt && Date.now() - p.lastDeployAt.getTime() < 60_000) return { error: "Tunggu satu menit sebelum build ulang." };
    if (isGitProject(p)) {
      const outcome = await guardedDeploy(p, "Build ulang dari dashboard");
      revalidatePath("/dashboard");
      if ("held" in outcome) return { error: `Build ditahan sampai admin meninjau: ${outcome.reason}` };
    } else {
      // ZIP yang sama dengan yang sudah ditinjau/tayang.
      await triggerDeploy(p, "Build ulang dari dashboard");
      revalidatePath("/dashboard");
    }
    return { ok: "Build ulang dimulai." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Unggah ZIP versi baru untuk project drop yang sudah disetujui. */
export async function uploadNewVersion(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { user, p } = await ownProject(String(form.get("id")));
    if (p.provider !== "drop") return { error: "Project ini bersumber dari repository git. Update lewat push." };
    if (!["LIVE", "FAILED"].includes(p.status) || !p.dokployAppId) return { error: "Project belum disetujui admin." };
    if (p.lastDeployAt && Date.now() - p.lastDeployAt.getTime() < 60_000) return { error: "Tunggu satu menit sebelum upload lagi." };
    const up = await readZip(form);
    if (!up) return { error: "Pilih file ZIP." };
    const pf = up.preflight;
    if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "ZIP belum lolos pemeriksaan." };
    const id = await storeUpload(user.id, up, pf);
    const outcome = await deployNewUpload(p, id, pf);
    await pruneUploads(user.id);
    revalidatePath("/dashboard");
    if ("held" in outcome) return { ok: `Upload diterima dan menunggu tinjauan admin: ${outcome.reason}` };
    return { ok: "Upload diterima. Build dimulai." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function archiveOwnProject(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { p } = await ownProject(String(form.get("id")));
    if (p.status === "ARCHIVED") return { ok: "Sudah diarsipkan." };
    await archiveProject(p);
    revalidatePath("/dashboard");
    revalidatePath("/");
    return { ok: "Website diarsipkan. Kuota project-mu bertambah satu." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}
