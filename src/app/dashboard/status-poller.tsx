"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Selama build berjalan, cek status tiap 6 detik lalu segarkan halaman saat berubah. */
export function StatusPoller({ projectId, status, deployState }: { projectId: string; status: string; deployState: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const t = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/status`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok || stop) return;
      const d = await res.json();
      if (d.status !== status || d.deployState !== deployState) router.refresh();
    }, 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [projectId, status, deployState, router]);
  return null;
}
