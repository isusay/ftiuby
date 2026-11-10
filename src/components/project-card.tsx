import Link from "next/link";
import type { ProjectCard as Card } from "@/lib/queries";
import { LikeButton } from "./like-button";

const TINTS = ["#2b3ff2", "#0e8a6a", "#c2410c", "#7c3aed", "#0369a1", "#b4235a"];

function tintFor(slug: string) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function ProjectCard({ p, canLike, rank, sitesDomain }: { p: Card; canLike: boolean; rank?: number; sitesDomain: string }) {
  const tint = tintFor(p.slug);
  return (
    <article className="panel overflow-hidden flex flex-col">
      <Link href={`/projects/${p.slug}`} className="block relative h-36 overflow-hidden" style={{ background: tint }} aria-label={`Lihat ${p.title}`}>
        <span
          aria-hidden="true"
          className="absolute -bottom-6 -right-2 font-display font-extrabold text-white/90 leading-none select-none"
          style={{ fontSize: "8.5rem" }}
        >
          {p.title.trim().charAt(0).toUpperCase()}
        </span>
        <span className="absolute top-3 left-3 rounded bg-white/95 px-2 py-0.5 font-mono text-[0.72rem] text-[#142042] max-w-[85%] truncate">
          {p.slug}.{sitesDomain}
        </span>
        {rank !== undefined && (
          <span className="absolute bottom-3 left-3 font-display text-3xl font-extrabold text-white">#{rank}</span>
        )}
      </Link>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <p className="text-sm text-muted">{p.category}</p>
        <h3 className="text-xl font-bold">
          <Link href={`/projects/${p.slug}`} className="hover:underline underline-offset-4">{p.title}</Link>
        </h3>
        <p className="text-[0.95rem] text-muted line-clamp-2">{p.description}</p>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm min-w-0">
            {p.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatarUrl} alt="" width={22} height={22} className="rounded-full shrink-0" />
            )}
            <span className="truncate">@{p.login}</span>
          </span>
          <LikeButton projectId={p.id} initialLiked={p.liked} initialCount={p.likeCount} canLike={canLike} />
        </div>
      </div>
    </article>
  );
}
