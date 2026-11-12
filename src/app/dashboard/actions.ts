"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql, isNull, or, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { invites, projects, users } from "@/lib/schema";
import { AuthError, requireActiveUser, requireUser } from "@/lib/session";
import { listBranches, listPublicRepos, GitHubError } from "@/lib/github";
import { runPreflight, BRANCH_RE, REPO_PART_RE, type PreflightResult } from "@/lib/preflight";
import { normalizeSlug, slugProblem } from "@/lib/slug";
import { randomSecret } from "@/lib/id";
import { archiveProject, guardedDeploy, resolveProjectRepo, RepoAccessError } from "@/lib/deploy";
import { CATEGORIES, slotStats } from "@/lib/queries";

export type FormState = { error?: string; ok?: string } | null;

function errMsg(e: unknown) {
  if (e instanceof AuthError || e instanceof GitHubError || e instanceof RepoAccessError) return e.message;
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

/* ---------- Repository & preflight ---------- */

export async function loadRepos(): Promise<{ repos?: { name: string; branch: string; description: string | null }[]; error?: string }> {
  try {
    const user = await requireActiveUser();
    const repos = await listPublicRepos(user.login);
    return { repos: repos.map((r) => ({ name: r.name, branch: r.default_branch, description: r.description })) };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function loadBranches(repo: string): Promise<{ branches?: string[]; error?: string }> {
  try {
    const user = await requireActiveUser();
    if (!REPO_PART_RE.test(repo)) return { error: "Nama repository tidak valid." };
    return { branches: await listBranches(user.login, repo) };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function checkRepo(repo: string, branch: string): Promise<PreflightResult | { error: string }> {
  try {
    const user = await requireActiveUser();
    return await runPreflight(user.login, repo, branch, { ownerId: user.githubId });
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/* ---------- Pengajuan ---------- */

const submitSchema = z.object({
  repo: z.string().regex(REPO_PART_RE, "Pilih repository."),
  branch: z.string().regex(BRANCH_RE, "Pilih branch."),
  slug: z.string().min(1, "Isi nama subdomain."),
  title: z.string().trim().min(3, "Judul minimal 3 karakter.").max(60, "Judul maksimal 60 karakter."),
  description: z.string().trim().min(10, "Deskripsi minimal 10 karakter.").max(240, "Deskripsi maksimal 240 karakter."),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Pilih kategori." }) }),
});

async function hasActiveProject(userId: string, exceptId?: string) {
  const where = exceptId
    ? and(eq(projects.userId, userId), ne(projects.status, "ARCHIVED"), ne(projects.id, exceptId))
    : and(eq(projects.userId, userId), ne(projects.status, "ARCHIVED"));
  return !!(await db.query.projects.findFirst({ where }));
}

export async function submitProject(_: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireActiveUser();
    const data = submitSchema.parse(Object.fromEntries(form));
    const slug = normalizeSlug(data.slug);
    const problem = slugProblem(slug);
    if (problem) return { error: problem };

    if (await hasActiveProject(user.id)) return { error: "Kamu sudah punya satu website aktif. Arsipkan dulu untuk mengajukan yang baru." };

    const taken = await db.query.projects.findFirst({ where: eq(projects.slug, slug) });
    if (taken && taken.userId !== user.id) return { error: `Subdomain ${slug} sudah dipakai. Pilih nama lain.` };
    if (taken) return { error: `Subdomain ${slug} milik project lamamu. Pakai tombol "Ajukan lagi" di riwayat.` };

    // Preflight diulang di server: hasil dari browser tidak dipercaya.
    const pf = await runPreflight(user.login, data.repo, data.branch, { ownerId: user.githubId });
    if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "Repository belum lolos pemeriksaan." };

    await db.insert(projects).values({
      slug,
      title: data.title,
      description: data.description,
      category: data.category,
      repoOwner: user.login,
      repoName: data.repo,
      repoId: pf.repoId,
      branch: data.branch,
      framework: pf.framework,
      outputDir: pf.outputDir,
      buildCommand: pf.buildCommand,
      packageManager: pf.packageManager,
      webhookSecret: randomSecret(),
      userId: user.id,
    });
    revalidatePath("/dashboard");
    return { ok: "Pengajuan terkirim. Admin akan meninjau repository-mu." };
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
    if (own.status === "ARCHIVED" && (await hasActiveProject(user.id, own.id))) {
      return { error: "Arsipkan website aktifmu dulu sebelum mengajukan yang ini." };
    }
    const branch = String(form.get("branch") ?? own.branch);
    if (!BRANCH_RE.test(branch)) return { error: "Nama branch tidak valid." };

    // Pastikan repo masih milikmu (dicek lewat ID GitHub) dan pakai namanya yang terkini.
    const p = await resolveProjectRepo(own);
    const pf = await runPreflight(p.repoOwner, p.repoName, branch, { ownerId: user.githubId });
    if (!pf.ok || !pf.framework || !pf.outputDir) return { error: pf.errors[0] ?? "Repository belum lolos pemeriksaan." };

    await db
      .update(projects)
      .set({
        branch,
        framework: pf.framework,
        outputDir: pf.outputDir,
        buildCommand: pf.buildCommand,
        packageManager: pf.packageManager,
        repoId: pf.repoId,
        status: "SUBMITTED",
      })
      .where(eq(projects.id, p.id));
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
    const outcome = await guardedDeploy(p, "Build ulang dari dashboard");
    revalidatePath("/dashboard");
    if ("held" in outcome) return { error: `Build ditahan sampai admin meninjau: ${outcome.reason}` };
    return { ok: "Build ulang dimulai." };
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
    return { ok: "Website diarsipkan. Slot-mu terbuka lagi." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}
