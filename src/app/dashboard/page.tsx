import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { accounts, projects, type Project } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { isGitProject, siteUrl, sourceLabel, syncProject } from "@/lib/deploy";
import { CATEGORIES, projectQuota, slotStats } from "@/lib/queries";
import { FRAMEWORK_LABEL } from "@/lib/preflight";
import { enabledProviders, oauthProviders } from "@/lib/oauth";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm } from "@/components/action-form";
import { InviteForm } from "./invite-form";
import { SubmitForm, type SourceOption } from "./submit-form";
import { StatusPoller } from "./status-poller";
import { CopyField } from "./copy-field";
import {
  archiveOwnProject, redeployProject, resubmitProject, unlinkAccount, uploadNewVersion,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — ftiuby" };

const PROVIDER_ICON: Record<string, string> = {
  github: "M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z",
  gitlab: "m23.6 9.6-.03-.09-3.26-8.5a.85.85 0 0 0-1.62.06l-2.2 6.74H7.5L5.3 1.07a.85.85 0 0 0-1.62-.06L.43 9.5l-.03.09a6.05 6.05 0 0 0 2 7l.01.01.03.02 4.97 3.72 2.46 1.86 1.5 1.13a1 1 0 0 0 1.22 0l1.5-1.13 2.46-1.86 5-3.74.01-.01a6.06 6.06 0 0 0 2.04-6.99z",
};

function ProviderIcon({ id }: { id: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PROVIDER_ICON[id]} />
    </svg>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string; linked?: string }> }) {
  const { error, linked } = await searchParams;
  const user = await getCurrentUser();
  const providers = enabledProviders();

  if (!user) {
    return (
      <section className="mx-auto max-w-xl px-4 py-24">
        <h1 className="text-5xl font-extrabold mb-4">Masuk untuk publish</h1>
        <p className="text-lg text-muted mb-8">
          Kami hanya membaca profil publikmu. Repository di-clone langsung dari provider-nya, tanpa akses ke akunmu.
        </p>
        {error && <p role="alert" className="mb-6 text-danger font-semibold">{error}</p>}
        <div className="flex flex-wrap gap-3">
          {providers.map((p) => (
            <a key={p} href={`/api/auth/${p}`} className="btn btn-primary">
              <ProviderIcon id={p} />
              Masuk dengan {oauthProviders[p].label}
            </a>
          ))}
          {providers.length === 0 && <p className="text-danger">Belum ada provider login yang dikonfigurasi.</p>}
        </div>
      </section>
    );
  }

  const linkedAccounts = await db.query.accounts.findMany({ where: eq(accounts.userId, user.id), orderBy: asc(accounts.createdAt) });

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

  const notices = (
    <>
      {error && <p role="alert" className="mb-6 text-danger font-semibold">{error}</p>}
      {linked && oauthProviders[linked as keyof typeof oauthProviders] && (
        <p role="status" className="mb-6 text-ok font-semibold">
          Akun {oauthProviders[linked as keyof typeof oauthProviders].label} berhasil dihubungkan.
        </p>
      )}
    </>
  );

  const accountsPanel = (
    <div className="panel p-6 sm:p-8 mb-8">
      <h2 className="text-xl font-bold mb-1">Akun terhubung</h2>
      <p className="text-muted mb-4">Login dengan akun mana pun di bawah. Repository bisa diambil dari setiap akun yang terhubung.</p>
      <ul className="space-y-3">
        {providers.map((p) => {
          const a = linkedAccounts.find((x) => x.provider === p);
          return (
            <li key={p} className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <ProviderIcon id={p} />
                <span className="font-semibold">{oauthProviders[p].label}</span>
                {a ? <span className="text-muted">@{a.login}</span> : <span className="text-muted">belum terhubung</span>}
              </span>
              {a ? (
                linkedAccounts.length > 1 && (
                  <ActionForm
                    action={unlinkAccount}
                    hidden={{ provider: p }}
                    label="Putuskan"
                    variant="danger"
                    confirm={`Putuskan akun ${oauthProviders[p].label}?`}
                  />
                )
              ) : (
                <a href={`/api/auth/${p}?link=1`} className="btn btn-ghost btn-sm">Hubungkan</a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  if (!user.activatedAt) {
    const slots = await slotStats();
    return (
      <section className="mx-auto max-w-3xl px-4 py-14">
        {header}
        {notices}
        <div className="panel p-6 sm:p-8 mb-8">
          <h2 className="text-2xl font-bold mb-2">Aktifkan akun dengan kode undangan</h2>
          <p className="text-muted mb-6">
            Selama beta, akun baru butuh kode dari admin. Tersisa {slots.available} dari {slots.total} slot.
          </p>
          <InviteForm />
        </div>
        {accountsPanel}
      </section>
    );
  }

  const all = await db.query.projects.findMany({
    where: eq(projects.userId, user.id),
    orderBy: desc(projects.createdAt),
  });
  const active = await Promise.all(all.filter((p) => p.status !== "ARCHIVED").map((p) => syncProject(p)));
  const archived = all.filter((p) => p.status === "ARCHIVED");
  const quota = await projectQuota(user);

  const sources: SourceOption[] = [
    ...providers.map((p) => ({ id: p, label: oauthProviders[p].label, linked: linkedAccounts.some((a) => a.provider === p) })),
    ...(env.dropEnabled ? [{ id: "drop" as const, label: "Upload ZIP", linked: true }] : []),
  ];

  return (
    <section className="mx-auto max-w-4xl px-4 py-14">
      {header}
      {notices}

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-2xl font-bold">Website-mu</h2>
        <p className="text-muted">{quota.used} dari {quota.limit} project aktif</p>
      </div>
      {active.length === 0 && <p className="panel p-6 text-muted mb-8">Belum ada website aktif.</p>}
      <div className="space-y-8 mb-12">
        {active.map((p) => <ProjectPanel key={p.id} p={p} />)}
      </div>

      {quota.available > 0 ? (
        <details className="panel p-6 sm:p-8 mb-8" open={active.length === 0}>
          <summary className="text-2xl font-bold cursor-pointer">Publish website baru</summary>
          <p className="text-muted mt-2 mb-8">
            Sisa kuota: {quota.available} project. Ambil dari GitHub, GitLab, atau unggah ZIP. Pastikan sesuai Panduan.
          </p>
          <SubmitForm categories={CATEGORIES} sitesDomain={env.sitesDomain} sources={sources} />
        </details>
      ) : (
        <p className="panel p-6 text-muted mb-8">
          Kuota project aktifmu ({quota.limit}) sudah penuh. Arsipkan salah satu website, atau minta admin menambah kuota.
        </p>
      )}

      {accountsPanel}

      {archived.length > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Riwayat</h2>
          <ul className="space-y-3">
            {archived.map((p) => (
              <li key={p.id} className="panel p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold">{p.title}</p>
                  <p className="font-mono text-sm text-muted truncate">{p.slug}.{env.sitesDomain} · {sourceLabel(p)}</p>
                </div>
                {quota.available > 0 && (
                  <ActionForm action={resubmitProject} hidden={{ id: p.id }} label="Ajukan lagi" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ProjectPanel({ p }: { p: Project }) {
  const url = siteUrl(p.slug);
  const approved = !!p.dokployAppId;
  const building = p.status === "BUILDING" || p.deployState === "queued" || p.deployState === "running";
  const git = isGitProject(p);

  return (
    <div className="space-y-4">
      {building && <StatusPoller projectId={p.id} status={p.status} deployState={p.deployState} />}
      <div className="panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-3xl font-extrabold">{p.title}</h3>
            <p className="font-mono text-sm text-muted mt-1 break-all">{url.replace("https://", "")}</p>
          </div>
          <StatusBadge status={p.status} />
        </div>
        <p className="text-muted mb-6">{p.description}</p>

        <dl className="grid gap-4 sm:grid-cols-3 text-[0.95rem] mb-6">
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted">Sumber</dt>
            <dd className="font-mono text-sm break-all">{sourceLabel(p)}</dd>
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
              {git ? (
                <>
                  <label htmlFor={`rb-${p.id}`} className="lbl">Branch</label>
                  <input id={`rb-${p.id}`} name="branch" defaultValue={p.branch ?? ""} className="field font-mono max-w-xs" />
                </>
              ) : (
                <>
                  <label htmlFor={`rz-${p.id}`} className="lbl">ZIP terbaru (opsional)</label>
                  <input id={`rz-${p.id}`} name="zip" type="file" accept=".zip,application/zip" className="field max-w-xs" />
                </>
              )}
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
            confirm="Arsipkan website ini? Situs akan dimatikan dan kuota project-mu bertambah satu."
          />
        </div>
      </div>

      {approved && !git && (
        <div className="panel p-6 sm:p-8">
          <h4 className="text-xl font-bold mb-1">Unggah versi baru</h4>
          <p className="text-muted mb-4">
            Kalau hanya isi halaman yang berubah, situs langsung diperbarui. Perubahan package.json atau file konfigurasi build
            ditinjau admin dulu.
          </p>
          <ActionForm action={uploadNewVersion} hidden={{ id: p.id }} label="Unggah & deploy" pendingLabel="Mengunggah…">
            <input name="zip" type="file" accept=".zip,application/zip" required className="field max-w-md" aria-label="File ZIP versi baru" />
          </ActionForm>
        </div>
      )}

      {approved && git && <WebhookHelp p={p} />}
    </div>
  );
}

function WebhookHelp({ p }: { p: Project }) {
  const gitlab = p.provider === "gitlab";
  return (
    <div className="panel p-6 sm:p-8 space-y-4">
      <div>
        <h4 className="text-xl font-bold mb-1">Update otomatis saat push</h4>
        {gitlab ? (
          <p className="text-muted">
            Di GitLab: project → Settings → Webhooks → Add new webhook. Isi URL dan Secret token di bawah, centang
            &quot;Push events&quot;.
          </p>
        ) : (
          <p className="text-muted">
            Di GitHub: repository → Settings → Webhooks → Add webhook. Isi dua nilai di bawah, content type{" "}
            <span className="font-mono">application/json</span>, pilih &quot;Just the push event&quot;.
          </p>
        )}
      </div>
      <CopyField label={gitlab ? "URL" : "Payload URL"} value={`${env.appUrl}/api/webhooks/${p.provider}/${p.id}`} />
      <CopyField label={gitlab ? "Secret token" : "Secret"} value={p.webhookSecret} secret />
    </div>
  );
}

function StatusMessage({ p, building }: { p: Project; building: boolean }) {
  if (p.status === "SUBMITTED") return <p>Pengajuan sudah masuk dan menunggu review admin. Kami akan memproses secepatnya.</p>;
  if (p.status === "NEEDS_REVISION") return <p>Admin meminta perbaikan. Perbaiki kodenya, lalu kirim ulang.</p>;
  if (p.status === "FAILED")
    return <p>Build pertama gagal. Coba jalankan build di komputermu, perbaiki error-nya, lalu update dan klik Build ulang.</p>;
  if (building)
    return <p>Server sedang membangun situsmu. Halaman ini diperbarui otomatis; biasanya selesai dalam 1–5 menit.</p>;
  if (p.status === "LIVE" && p.deployState === "error")
    return <p className="text-danger">Build terakhir gagal. Versi sebelumnya masih tayang.</p>;
  if (p.status === "LIVE") return <p>Situsmu live dan tampil di galeri.</p>;
  return null;
}
