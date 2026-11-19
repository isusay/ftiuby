import type { Project } from "@/lib/schema";
import { diagnoseBuild } from "@/lib/build-diagnosis";
import { ActionForm } from "./action-form";

type State = { error?: string; ok?: string } | null;

/**
 * Penjelasan build yang gagal: penyebab (hasil diagnosis log), langkah perbaikan,
 * dan log lengkap yang bisa dibuka. Tampil bila deploy terakhir gagal.
 */
export function BuildFailure({
  p,
  refresh,
  audience,
}: {
  p: Project;
  refresh: (s: State, f: FormData) => Promise<State>;
  audience: "admin" | "developer";
}) {
  const failed = p.deployState === "error" || p.status === "FAILED";
  if (!failed) return null;
  const d = diagnoseBuild(p.deployLog);
  const stillLive = p.status === "LIVE";

  return (
    <div className="my-4 rounded-lg border border-danger/40 bg-paper p-4 space-y-3" role="region" aria-label="Penyebab build gagal">
      <div>
        <p className="font-semibold text-danger">
          {stillLive ? "Build terakhir gagal (versi sebelumnya masih tayang)" : "Build gagal"}
          {p.deployErrorAt && (
            <span className="font-normal text-muted text-sm"> · {p.deployErrorAt.toLocaleString("id-ID")}</span>
          )}
        </p>
        {p.deployLog ? (
          <p className="mt-1 font-semibold">{d.title}</p>
        ) : (
          <p className="mt-1 text-muted">
            Log build belum diambil dari server. Klik &quot;Ambil log terbaru&quot; untuk melihat penyebabnya.
          </p>
        )}
      </div>

      {p.deployLog && (
        <>
          {d.evidence && (
            <pre className="font-mono text-xs whitespace-pre-wrap break-all rounded bg-surface p-2 border border-line">{d.evidence}</pre>
          )}
          <div>
            <p className="text-sm font-semibold mb-1">{audience === "admin" ? "Saran untuk developer" : "Yang perlu kamu lakukan"}</p>
            <ol className="list-decimal pl-5 space-y-1 text-[0.95rem]">
              {d.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Lihat log build (bagian akhir)</summary>
            <pre className="mt-2 max-h-80 overflow-auto font-mono text-xs whitespace-pre-wrap break-all rounded bg-surface p-3 border border-line">{p.deployLog}</pre>
          </details>
        </>
      )}

      {p.dokployAppId && (
        <ActionForm action={refresh} hidden={{ id: p.id }} label="Ambil log terbaru" pendingLabel="Mengambil log…" />
      )}
    </div>
  );
}
