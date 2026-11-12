"use client";
import { useState, useTransition } from "react";

export function LikeButton({
  projectId,
  initialLiked,
  initialCount,
  canLike,
}: {
  projectId: string;
  initialLiked: boolean;
  initialCount: number;
  canLike: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onClick() {
    if (!canLike) {
      window.location.href = "/dashboard";
      return;
    }
    start(async () => {
      const res = await fetch(`/api/projects/${projectId}/like`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "Gagal menyimpan.");
        return;
      }
      setMsg(null);
      setLiked(data.liked);
      setCount(data.likeCount);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={liked}
      title={msg ?? (liked ? "Batal suka" : "Suka karya ini")}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold transition-colors ${
        liked ? "border-accent bg-accent text-accent-ink" : "border-line hover:border-ink"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3.1 1.6-1.9 3.1-3.1 5.2-3.1 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" />
      </svg>
      <span>{count}</span>
      <span className="sr-only">suka</span>
    </button>
  );
}
