import type { ProjectStatus } from "@/lib/schema";

const LABEL: Record<ProjectStatus, string> = {
  SUBMITTED: "Menunggu review",
  NEEDS_REVISION: "Perlu revisi",
  BUILDING: "Sedang build",
  LIVE: "Live",
  FAILED: "Build gagal",
  ARCHIVED: "Diarsipkan",
};

export function statusLabel(s: ProjectStatus) {
  return LABEL[s];
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  if (status === "LIVE") return <span className="marker font-semibold text-sm">Live</span>;
  const tone =
    status === "FAILED" || status === "NEEDS_REVISION"
      ? "border-danger text-danger"
      : status === "BUILDING"
        ? "border-accent text-accent"
        : "border-line text-muted";
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-semibold ${tone}`}>{LABEL[status]}</span>;
}
