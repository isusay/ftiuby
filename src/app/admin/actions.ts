"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { invites, projects, users } from "@/lib/schema";
import { AuthError, requireAdmin } from "@/lib/session";
import {
  archiveProject, provisionProject, RepoAccessError, reviewedFields, reviewRepo, syncProject,
} from "@/lib/deploy";
import { dokploy, DokployError } from "@/lib/dokploy";
import { GitHubError } from "@/lib/github";

type State = { error?: string; ok?: string } | null;

function errMsg(e: unknown) {
  if (e instanceof AuthError || e instanceof DokployError || e instanceof GitHubError || e instanceof RepoAccessError) {
    return e.message;
  }
  console.error(e);
  return e instanceof Error ? e.message : "Terjadi kesalahan.";
}

async function loadProject(form: FormData) {
  await requireAdmin();
  const p = await db.query.projects.findFirst({ where: eq(projects.id, String(form.get("id"))) });
  if (!p) throw new AuthError("Project tidak ditemukan.");
  return p;
}

function done() {
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/leaderboard");
}

export async function approveProject(_: State, form: FormData): Promise<State> {
  try {
    const p = await loadProject(form);

    // Klaim pengajuan secara atomik: kalau dua admin menekan "Setujui" bersamaan,
    // hanya satu yang lolos sehingga aplikasi Dokploy tidak dibuat dua kali.
    const [claimed] = await db
      .update(projects)
      .set({ status: "BUILDING", adminNote: null })
      .where(and(eq(projects.id, p.id), eq(projects.status, "SUBMITTED")))
      .returning();
    if (!claimed) return { error: "Pengajuan ini sudah diproses atau bukan berstatus Menunggu review." };

    // Cek ulang repo saat disetujui: isi repo (dan pemiliknya) bisa berubah sejak diajukan.
    let review;
    try {
      review = await reviewRepo(claimed);
    } catch (e) {
      const note = e instanceof RepoAccessError ? e.message : `Pemeriksaan gagal: ${errMsg(e)}`;
      await db.update(projects).set({ status: e instanceof RepoAccessError ? "NEEDS_REVISION" : "SUBMITTED", adminNote: note }).where(eq(projects.id, p.id));
      done();
      return { error: note };
    }
    const { pf } = review;
    if (!pf.ok || !pf.framework || !pf.outputDir) {
      await db
        .update(projects)
        .set({ status: "NEEDS_REVISION", adminNote: `Pemeriksaan otomatis gagal: ${pf.errors.join(" ")}` })
        .where(eq(projects.id, p.id));
      done();
      return { error: "Repo tidak lolos pemeriksaan ulang; status diubah ke Perlu revisi." };
    }

    const [fresh] = await db
      .update(projects)
      .set(reviewedFields(pf))
      .where(eq(projects.id, p.id))
      .returning();
    try {
      await provisionProject(fresh);
    } catch (e) {
      await db
        .update(projects)
        .set({ status: "SUBMITTED", adminNote: `Provisioning Dokploy gagal: ${errMsg(e)}` })
        .where(eq(projects.id, p.id));
      throw e;
    }
    done();
    return { ok: "Disetujui. Build pertama dimulai di Dokploy." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function requestRevision(_: State, form: FormData): Promise<State> {
  try {
    const p = await loadProject(form);
    const note = String(form.get("note") ?? "").trim();
    if (note.length < 5) return { error: "Tulis catatan yang jelas untuk developer." };
    if (p.dokployAppId) await archiveProject(p); // matikan situs jika sudah pernah dibuat
    await db.update(projects).set({ status: "NEEDS_REVISION", adminNote: note.slice(0, 1000) }).where(eq(projects.id, p.id));
    done();
    return { ok: "Catatan revisi dikirim." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/**
 * Admin meninjau isi repo saat ini lalu build ulang. Fingerprint file build disimpan sebagai
 * versi yang sudah ditinjau, dan update yang tertahan dilepas.
 * Periksa perubahan di GitHub (link "Lihat perubahan") sebelum menekan tombol ini.
 */
export async function adminRedeploy(_: State, form: FormData): Promise<State> {
  try {
    const p = await loadProject(form);
    if (!p.dokployAppId) return { error: "Project belum punya aplikasi di Dokploy." };
    const { project, pf } = await reviewRepo(p);
    if (!pf.ok || !pf.framework || !pf.outputDir) {
      return { error: `Repo tidak lolos pemeriksaan: ${pf.errors.join(" ")} Minta revisi ke developer.` };
    }
    const [fresh] = await db.update(projects).set(reviewedFields(pf)).where(eq(projects.id, project.id)).returning();
    // provisionProject menyimpan ulang repo, tipe build & env (bisa berubah), lalu deploy.
    await provisionProject(fresh, "Build ulang setelah ditinjau admin");
    done();
    return { ok: "Ditinjau dan build ulang dimulai." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function adminSync(_: State, form: FormData): Promise<State> {
  try {
    const p = await loadProject(form);
    const s = await syncProject({ ...p, deployState: p.deployState === "done" || p.deployState === "error" ? "running" : p.deployState });
    done();
    return { ok: `Status: ${s.status} (${s.deployState ?? "—"})` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function adminArchive(_: State, form: FormData): Promise<State> {
  try {
    const p = await loadProject(form);
    await archiveProject(p);
    const note = String(form.get("note") ?? "").trim();
    if (note) await db.update(projects).set({ adminNote: note }).where(eq(projects.id, p.id));
    done();
    return { ok: "Diarsipkan dan aplikasi Dokploy dihapus." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/* ---------- Undangan & pengguna ---------- */

function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return "FTI-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createInvite(_: State, form: FormData): Promise<State> {
  try {
    const admin = await requireAdmin();
    const maxUses = Math.min(500, Math.max(1, Number(form.get("maxUses") ?? 1) || 1));
    const days = Number(form.get("days") ?? 0);
    const note = String(form.get("note") ?? "").trim().slice(0, 120) || null;
    const code = newCode();
    await db.insert(invites).values({
      code,
      maxUses,
      note,
      createdBy: admin.id,
      expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
    });
    revalidatePath("/admin");
    return { ok: `Kode dibuat: ${code}` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function deleteInvite(_: State, form: FormData): Promise<State> {
  try {
    await requireAdmin();
    await db.delete(invites).where(eq(invites.id, String(form.get("id"))));
    revalidatePath("/admin");
    return { ok: "Kode dihapus." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function toggleUserActive(_: State, form: FormData): Promise<State> {
  try {
    const admin = await requireAdmin();
    const id = String(form.get("id"));
    if (id === admin.id) return { error: "Tidak bisa mengubah akun sendiri." };
    const u = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!u) return { error: "Pengguna tidak ditemukan." };
    await db.update(users).set({ activatedAt: u.activatedAt ? null : new Date() }).where(eq(users.id, id));
    revalidatePath("/admin");
    return { ok: u.activatedAt ? "Akun dinonaktifkan." : "Akun diaktifkan." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/* ---------- Dokploy ---------- */

export async function checkDokploy(): Promise<{ ok: boolean; message: string; envs?: { project: string; name: string; id: string }[] }> {
  await requireAdmin();
  try {
    const list = await dokploy.projectAll();
    const envs = list.flatMap((p) =>
      (p.environments ?? []).map((e) => ({ project: p.name, name: e.name, id: e.environmentId })),
    );
    return { ok: true, message: `Terhubung. ${list.length} project ditemukan.`, envs };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
