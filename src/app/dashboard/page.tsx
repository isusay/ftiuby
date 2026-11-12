import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { projects, type Project } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { siteUrl, syncProject } from "@/lib/deploy";
import { CATEGORIES, slotStats } from "@/lib/queries";
import { FRAMEWORK_LABEL } from "@/lib/preflight";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm } from "@/components/action-form";
import { InviteForm } from "./invite-form";
import { SubmitForm } from "./submit-form";
import { StatusPoller } from "./status-poller";
import { CopyField } from "./copy-field";
import { archiveOwnProject, redeployProject, resubmitProject } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — ftiuby" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <section className="mx-auto max-w-xl px-4 py-24">
        <h1 className="text-5xl font-extrabold mb-4">Masuk untuk publish</h1>
        <p className="text-lg text-muted mb-8">
          Kami hanya membaca profil publik GitHub-mu. Repository di-clone langsung dari GitHub, tanpa akses ke akunmu.
        </p>
        {error && <p role="alert" className="mb-6 text-danger font-semibold">{error}</p>}
        <a href="/api/auth/github" className="btn btn-primary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
          </svg>
          Masuk dengan GitHub
        </a>
      </section>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-10">
      <div>
        <p className="text-muted">Halo, {user.name ?? user.login}</p>
        <h1 className="text-5xl font-extrabold">Dashboard</h1>
      </div>
      <form action="/api/auth/logout" method="post">
        <button className="btn btn-ghost btn-sm">Keluar</button>
      </form>
    </div>
  );

  if (!user.activatedAt) {
    const slots = await slotStats();
    return (
      <section className="mx-auto max-w-3xl px-4 py-14">
        {header}
        <div className="panel p-6 sm:p-8">
          <h2 className="text-2xl font-bold mb-2">Aktifkan akun dengan kode undangan</h2>
          <p className="text-muted mb-6">
            Selama beta, akun baru butuh kode dari admin. Tersisa {slots.available} dari {slots.total} slot.
          </p>
          <InviteForm />
        </div>
      </section>
    );
  }

  const all = await db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: desc(projects.createdAt),
  });
  const activeRaw = all.find((p) => p.status !== "ARCHIVED");
  const active = activeRaw ? await syncProject(activeRaw) : undefined;
  const archived = all.filter((p) => p.status === "ARCHIVED");

  return (
    <section className="mx-auto max-w-4xl px-4 py-14">
      {header}
      {active ? <ActiveProject p={active} /> : (
        <div className="panel p-6 sm:p-8">
          <h2 className="text-2xl font-bold mb-1">Publish website baru</h2>
          <p className="text-muted mb-8">Kamu bisa punya satu website aktif. Pastikan repo sudah sesuai Panduan.</p>
          <SubmitForm categories={CATEGORIES} sitesDomain={env.sitesDomain} />
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Riwayat</h2>
          <ul className="space-y-3">
            {archived.map((p) => (
              <li key={p.id} className="panel p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold">{p.title}</p>
                  <p className="font-mono text-sm text-muted truncate">{p.slug}.{env.sitesDomain} · {p.repoName}@{p.branch}</p>
                </div>
                {!active && (
                  <ActionForm action={resubmitProject} hidden={{ id: p.id, branch: p.branch }} label="Ajukan lagi" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ActiveProject({ p }: { p: Project }) {
  const url = siteUrl(p.slug);
  const approved = !!p.dokployAppId;
  const building = p.status === "BUILDING" || p.deployState === "queued" || p.deployState === "running";

  return (
    <div className="space-y-6">
      {building && <StatusPoller projectId={p.id} status={p.status} deployState={p.deployState} />}
      <div className="panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-3xl font-extrabold">{p.title}</h2>
            <p className="font-mono text-sm text-muted mt-1 break-all">{url.replace("https://", "")}</p>
          </div>
          <StatusBadge status={p.status} />
        </div>
        <p className="text-muted mb-6">{p.description}</p>

        <dl className="grid gap-4 sm:grid-cols-3 text-[0.95rem] mb-6">
          <div>
            <dt className="text-sm text-muted">Repository</dt>
            <dd className="font-mono text-sm break-all">{p.repoOwner}/{p.repoName}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Branch</dt>
            <dd className="font-mono text-sm">{p.branch}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Framework</dt>
            <dd>{FRAMEWORK_LABEL[p.framework]}</dd>
          </div>
        </dl>

        <StatusMessage p={p} building={building} />

        {p.reviewHeldAt && (
          <div className="mt-4 rounded-lg border-l-4 border-danger bg-paper p-4">
            <p className="font-semibold mb-1">Update menunggu tinjauan admin</p>
            <p>{p.reviewHeldReason}</p>
            <p className="text-muted text-sm mt-1">
              Situs versi sebelumnya tetap tayang. Perubahan pada package.json, lockfile, atau file konfigurasi build
              perlu dicek admin sebelum dijalankan di server.
            </p>
          </div>
        )}

        {p.adminNote && (p.status === "NEEDS_REVISION" || p.status === "FAILED") && (
          <div className="mt-4 rounded-lg border-l-4 border-danger bg-paper p-4">
            <p className="font-semibold mb-1">Catatan admin</p>
            <p className="whitespace-pre-line">{p.adminNote}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-start gap-3">
          {p.status === "LIVE" && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">Buka situs</a>
          )}
          {p.status === "NEEDS_REVISION" && (
            <ActionForm action={resubmitProject} hidden={{ id: p.id }} label="Kirim ulang" variant="primary">
              <label htmlFor="rb" className="lbl">Branch</label>
              <input id="rb" name="branch" defaultValue={p.branch} className="field font-mono max-w-xs" />
            </ActionForm>
          )}
          {approved && (p.status === "LIVE" || p.status === "FAILED") && (
            <ActionForm action={redeployProject} hidden={{ id: p.id }} label="Build ulang" pendingLabel="Memulai build…" />
          )}
          <ActionForm
            action={archiveOwnProject}
            hidden={{ id: p.id }}
            label="Arsipkan"
            variant="danger"
            confirm="Arsipkan website ini? Situs akan dimatikan dan slot-mu terbuka lagi."
          />
        </div>
      </div>

      {approved && (
        <div className="panel p-6 sm:p-8 space-y-4">
          <div>
            <h3 className="text-xl font-bold mb-1">Update otomatis saat push</h3>
            <p className="text-muted">
              Di GitHub: repository → Settings → Webhooks → Add webhook. Isi dua nilai di bawah, content type{" "}
              <span className="font-mono">application/json</span>, pilih &quot;Just the push event&quot;.
            </p>
          </div>
          <CopyField label="Payload URL" value={`${env.appUrl}/api/webhooks/github/${p.id}`} />
          <CopyField label="Secret" value={p.webhookSecret} secret />
        </div>
      )}
    </div>
  );
}

function StatusMessage({ p, building }: { p: Project; building: boolean }) {
  if (p.status === "SUBMITTED") return <p>Pengajuan sudah masuk dan menunggu review admin. Kami akan memproses secepatnya.</p>;
  if (p.status === "NEEDS_REVISION") return <p>Admin meminta perbaikan. Perbaiki repository, lalu kirim ulang.</p>;
  if (p.status === "FAILED")
    return <p>Build pertama gagal. Coba jalankan build di komputermu, perbaiki error-nya, lalu push atau klik Build ulang.</p>;
  if (building)
    return <p>Server sedang membangun situsmu. Halaman ini diperbarui otomatis; biasanya selesai dalam 1–5 menit.</p>;
  if (p.status === "LIVE" && p.deployState === "error")
    return <p className="text-danger">Build terakhir gagal. Versi sebelumnya masih tayang.</p>;
  if (p.status === "LIVE") return <p>Situsmu live dan tampil di galeri.</p>;
  return null;
}
