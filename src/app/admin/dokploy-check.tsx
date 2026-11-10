"use client";
import { useState, useTransition } from "react";
import { checkDokploy } from "./actions";

export function DokployCheck() {
  const [res, setRes] = useState<Awaited<ReturnType<typeof checkDokploy>> | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="panel p-6 max-w-3xl">
      <h2 className="text-xl font-bold mb-2">Koneksi Dokploy</h2>
      <p className="text-muted mb-4">
        Uji API key dan lihat daftar environment. Salin ID environment tempat situs pengguna dibuat ke variabel{" "}
        <span className="font-mono">DOKPLOY_ENVIRONMENT_ID</span>.
      </p>
      <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => setRes(await checkDokploy()))}>
        {pending ? "Menghubungi Dokploy…" : "Uji koneksi"}
      </button>
      {res && (
        <div className="mt-5">
          <p className={res.ok ? "text-ok font-semibold" : "text-danger font-semibold"}>{res.message}</p>
          {res.envs && res.envs.length > 0 && (
            <table className="w-full text-left text-sm mt-4">
              <thead className="border-b border-line"><tr><th className="py-2">Project</th><th>Environment</th><th>ID</th></tr></thead>
              <tbody>
                {res.envs.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="py-2">{e.project}</td><td>{e.name}</td><td className="font-mono break-all">{e.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
