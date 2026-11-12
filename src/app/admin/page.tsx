import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray, isNotNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { accounts, invites, projects, users, type Project, type ProjectStatus } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { FRAMEWORK_LABEL } from "@/lib/preflight";
import { slotStats } from "@/lib/queries";
import { isGitProject, sourceLabel, sourceUrl } from "@/lib/deploy";
import { gitHost } from "@/lib/git";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm } from "@/components/action-form";
import {
  adminArchive, adminRedeploy, adminSync, approveProject, createInvite,
  deleteInvite, requestRevision, setUserLimit, toggleUserActive,
} from "./actions";
import { DokployCheck } from "./dokploy-check";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — ftiuby" };

const TABS: { key: string; label: string; statuses: ProjectStatus[]; held?: boolean }[] = [
  { key: "antrean", label: "Antrean", statuses: ["SUBMITTED"] },
  { key: "tertahan", label: "Update tertahan", statuses: [], held: true },
  { key: "proses", label: "Build & gagal", statuses: ["BUILDING", "FAILED"] },
  { key: "live", label: "Live", statuses: ["LIVE"] },
  { key: "revisi", label: "Perlu revisi", statuses: ["NEEDS_REVISION"] },
  { key: "arsip", label: "Arsip", statuses: ["ARCHIVED"] },
];

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") notFound();
  const { tab = "antrean", view = "project" } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  const counts = await db.select({ status: projects.status, n: count() }).from(projects).groupBy(projects.status);
  const [{ held }] = await db.select({ held: count() }).from(projects).where(isNotNull(projects.reviewHeldAt));
  const countOf = (t: (typeof TABS)[number]) =>
    t.held ? Number(held) : counts.filter((c) => t.statuses.includes(c.status)).reduce((a, c) => a + Number(c.n), 0);
  const slots = await slotStats();

  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-5xl font-extrabold mb-2">Admin</h1>
      <p className="text-muted mb-8">
        {slots.used}/{slots.total} slot beta terpakai · {slots.live} situs live · domain *.{env.sitesDomain}
      </p>

      <nav className="flex flex-wrap gap-2 mb-8" aria-label="Bagian admin">
        {[
          ["project", "Pengajuan"],
          ["invite", "Kode undangan"],
          ["user", "Pengguna"],
          ["dokploy", "Koneksi Dokploy"],
        ].map(([k, l]) => (
          <Link key={k} href={`/admin?view=${k}`} className={`btn btn-sm ${view === k ? "btn-primary" : "btn-ghost"}`}>{l}</Link>
        ))}
      </nav>

      {view === "project" && (
        <>
          <nav className="flex flex-wrap gap-2 mb-6 border-b border-line" aria-label="Status">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/admin?view=project&tab=${t.key}`}
                className={`px-3 py-2 -mb-px border-b-2 ${t.key === current.key ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t.label} <span className="text-muted">({countOf(t)})</span>
              </Link>
            ))}
          </nav>
          <ProjectList statuses={current.statuses} held={current.held} />
        </>
      )}
      {view === "invite" && <Invites />}
      {view === "user" && <Users />}
      {view === "dokploy" && <DokployCheck />}
    </section>
  );
}

async function ProjectList({ statuses, held }: { statuses: ProjectStatus[]; held?: boolean }) {
  const rows = await db
    .select({ p: projects, login: users.login })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(held ? isNotNull(projects.reviewHeldAt) : inArray(projects.status, statuses))
    .orderBy(desc(projects.updatedAt))
    .limit(100);

  if (rows.length === 0) return <p className="panel p-8 text-center text-muted">Tidak ada project di bagian ini.</p>;

  return (
    <ul className="space-y-4">
      {rows.map(({ p, login }) => (
        <li key={p.id} className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold">{p.title}</h2>
              <p className="font-mono text-sm text-muted break-all">{p.slug}.{env.sitesDomain}</p>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-[0.95rem] mb-3">{p.description}</p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-4">
            <div><dt className="inline text-muted">Pemilik </dt><dd className="inline font-semibold">@{login}</dd></div>
            <div>
              <dt className="inline text-muted">Sumber </dt>
              <dd className="inline">
                {sourceUrl(p) ? (
                  <a className="font-mono underline underline-offset-2" href={sourceUrl(p)!} target="_blank" rel="noopener noreferrer">
                    {sourceLabel(p)}
                  </a>
                ) : (
                  <>
                    <span className="font-mono">{sourceLabel(p)}</span>
                    {p.uploadId && (
                      <> · <a className="underline underline-offset-2" href={`/api/uploads/${p.uploadId}`}>unduh ZIP</a></>
                    )}
                  </>
                )}
              </dd>
            </div>
            <div><dt className="inline text-muted">Framework </dt><dd className="inline">{FRAMEWORK_LABEL[p.framework]} → <span className="font-mono">{p.outputDir}</span></dd></div>
            <div><dt className="inline text-muted">Deploy </dt><dd className="inline">{p.deployState ?? "—"}</dd></div>
          </dl>
          {p.adminNote && <p className="text-sm text-muted mb-4 whitespace-pre-line">Catatan: {p.adminNote}</p>}
          {p.reviewHeldAt && (
            <div className="mb-4 rounded-lg border-l-4 border-danger bg-paper p-4 text-sm">
              <p className="font-semibold mb-1">Update ditahan sejak {p.reviewHeldAt.toLocaleString("id-ID")}</p>
              <p className="mb-2">{p.reviewHeldReason}</p>
              <p className="text-muted">
                Periksa perubahannya, terutama <span className="font-mono">scripts</span>, dependency baru, dan file konfigurasi
                {" "}sebelum menekan &quot;Tinjau &amp; build ulang&quot;.{" "}
                <ReviewLink p={p} />
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-start gap-4">
            {p.status === "SUBMITTED" && (
              <ActionForm action={approveProject} hidden={{ id: p.id }} label="Setujui & deploy" pendingLabel="Membuat aplikasi di Dokploy…" variant="primary" />
            )}
            {p.status !== "ARCHIVED" && p.status !== "NEEDS_REVISION" && (
              <details className="min-w-64">
                <summary className="btn btn-ghost btn-sm list-none">Minta revisi</summary>
                <div className="mt-3">
                  <ActionForm action={requestRevision} hidden={{ id: p.id }} label="Kirim catatan">
                    <textarea name="note" required className="field min-h-20" placeholder="Apa yang perlu diperbaiki?" />
                  </ActionForm>
                </div>
              </details>
            )}
            {p.dokployAppId && (
              <>
                <ActionForm
                  action={adminRedeploy}
                  hidden={{ id: p.id }}
                  label={p.reviewHeldAt ? "Tinjau & build ulang" : "Build ulang"}
                  pendingLabel="Memeriksa repo…"
                  variant={p.reviewHeldAt ? "primary" : undefined}
                  confirm={p.reviewHeldAt ? "Sudah memeriksa perubahan file build? Kode ini akan dijalankan di server saat build." : undefined}
                />
                <ActionForm action={adminSync} hidden={{ id: p.id }} label="Cek status" />
              </>
            )}
            {p.status !== "ARCHIVED" && (
              <ActionForm action={adminArchive} hidden={{ id: p.id }} label="Arsipkan" variant="danger" confirm={`Arsipkan ${p.slug}? Aplikasi di Dokploy akan dihapus.`} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReviewLink({ p }: { p: Project }) {
  if (isGitProject(p)) {
    const host = gitHost(p.provider);
    const href = p.reviewedCommit ? host.compareUrl(p.repoPath, p.reviewedCommit, p.branch) : host.commitsUrl(p.repoPath, p.branch);
    return (
      <a className="underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
        Lihat perubahan di {host.label}
      </a>
    );
  }
  return (
    <>
      {p.pendingUploadId && <a className="underline underline-offset-2" href={`/api/uploads/${p.pendingUploadId}`}>Unduh ZIP baru</a>}
      {p.uploadId && <> · <a className="underline underline-offset-2" href={`/api/uploads/${p.uploadId}`}>ZIP yang tayang</a></>}
    </>
  );
}

async function Invites() {
  const list = await db.select().from(invites).orderBy(desc(invites.createdAt)).limit(100);
  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
      <div className="panel p-5 self-start">
        <h2 className="text-xl font-bold mb-4">Buat kode baru</h2>
        <ActionForm action={createInvite} label="Buat kode" variant="primary">
          <div>
            <label htmlFor="maxUses" className="lbl">Bisa dipakai berapa kali</label>
            <input id="maxUses" name="maxUses" type="number" min={1} max={500} defaultValue={1} className="field" />
          </div>
          <div>
            <label htmlFor="days" className="lbl">Kedaluwarsa (hari, 0 = tidak)</label>
            <input id="days" name="days" type="number" min={0} defaultValue={14} className="field" />
          </div>
          <div>
            <label htmlFor="note" className="lbl">Catatan</label>
            <input id="note" name="note" className="field" placeholder="Misal: kelas Pemrograman Web A" />
          </div>
        </ActionForm>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-[0.95rem]">
          <thead className="border-b border-line">
            <tr>
              <th className="p-3">Kode</th><th className="p-3">Terpakai</th><th className="p-3">Kedaluwarsa</th><th className="p-3">Catatan</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">Belum ada kode. Buat satu untuk mengundang developer.</td></tr>
            )}
            {list.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="p-3 font-mono">{i.code}</td>
                <td className="p-3">{i.uses}/{i.maxUses}</td>
                <td className="p-3">{i.expiresAt ? i.expiresAt.toLocaleDateString("id-ID") : "—"}</td>
                <td className="p-3 text-muted">{i.note ?? ""}</td>
                <td className="p-3"><ActionForm action={deleteInvite} hidden={{ id: i.id }} label="Hapus" variant="danger" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function Users() {
  const list = await db.select().from(users).orderBy(desc(users.createdAt)).limit(200);
  const accts = await db.select().from(accounts).where(inArray(accounts.userId, list.length ? list.map((u) => u.id) : [""]));
  const used = await db
    .select({ userId: projects.userId, n: count() })
    .from(projects)
    .where(inArray(projects.status, ["SUBMITTED", "NEEDS_REVISION", "BUILDING", "LIVE", "FAILED"]))
    .groupBy(projects.userId);
  return (
    <div className="panel overflow-x-auto">
      <p className="p-3 text-sm text-muted border-b border-line">Kuota default: {env.maxProjectsPerUser} project aktif per pengguna (MAX_PROJECTS_PER_USER).</p>
      <table className="w-full text-left text-[0.95rem]">
        <thead className="border-b border-line">
          <tr><th className="p-3">Pengguna</th><th className="p-3">Akun</th><th className="p-3">Peran</th><th className="p-3">Status</th><th className="p-3">Project / kuota</th><th className="p-3"></th></tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id} className="border-b border-line last:border-0 align-top">
              <td className="p-3">
                <span className="font-semibold">@{u.login}</span>
                {u.name && <span className="text-muted"> · {u.name}</span>}
                <div className="text-sm text-muted">Bergabung {u.createdAt.toLocaleDateString("id-ID")}</div>
              </td>
              <td className="p-3 text-sm">
                {accts.filter((a) => a.userId === u.id).map((a) => (
                  <div key={a.id}>{gitHost(a.provider).label}: @{a.login}</div>
                ))}
              </td>
              <td className="p-3">{u.role === "ADMIN" ? "Admin" : "Developer"}</td>
              <td className="p-3">{u.activatedAt ? "Aktif" : "Belum aktif"}</td>
              <td className="p-3">
                <ActionForm action={setUserLimit} hidden={{ id: u.id }} label="Simpan">
                  <label className="text-sm">
                    {Number(used.find((x) => x.userId === u.id)?.n ?? 0)} /{" "}
                    <input
                      name="limit"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={u.projectLimit ?? ""}
                      placeholder={String(env.maxProjectsPerUser)}
                      className="field inline-block w-20 py-1"
                      aria-label={`Kuota project @${u.login}`}
                    />
                  </label>
                </ActionForm>
              </td>
              <td className="p-3">
                {u.role !== "ADMIN" && (
                  <ActionForm action={toggleUserActive} hidden={{ id: u.id }} label={u.activatedAt ? "Nonaktifkan" : "Aktifkan"} variant={u.activatedAt ? "danger" : "ghost"} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
