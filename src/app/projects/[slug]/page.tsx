import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, users, likes } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { siteUrl, sourceLabel, sourceUrl } from "@/lib/deploy";
import { gitHost } from "@/lib/git";
import { FRAMEWORK_LABEL } from "@/lib/preflight";
import { LikeButton } from "@/components/like-button";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const [row] = await db
    .select({ p: projects, login: users.login, avatarUrl: users.avatarUrl, name: users.name })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(eq(projects.slug, slug), eq(projects.status, "LIVE")))
    .limit(1);
  return row;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await load(slug);
  return row ? { title: `${row.p.title} — ftiuby`, description: row.p.description } : { title: "Tidak ditemukan — ftiuby" };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await load(slug);
  if (!row) notFound();
  const { p } = row;
  const user = await getCurrentUser();
  const liked = user
    ? !!(await db.query.likes.findFirst({ where: and(eq(likes.userId, user.id), eq(likes.projectId, p.id)) }))
    : false;
  const url = siteUrl(p.slug);
  const code = sourceUrl(p);

  return (
    <article className="mx-auto max-w-6xl px-4 py-12">
      <p className="text-muted mb-2">{p.category}</p>
      <h1 className="text-5xl sm:text-6xl font-extrabold mb-4">{p.title}</h1>
      <p className="text-lg max-w-[62ch] mb-6">{p.description}</p>

      <div className="flex flex-wrap items-center gap-3 mb-10">
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Buka situs</a>
        {code && (
          <a href={code} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            Lihat kode di {gitHost(p.provider).label}
          </a>
        )}
        <LikeButton projectId={p.id} initialLiked={liked} initialCount={p.likeCount} canLike={!!user && user.id !== p.userId} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="font-mono text-sm truncate">{url.replace("https://", "")}</span>
          </div>
          <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
            <iframe
              src={url}
              title={`Pratinjau ${p.title}`}
              loading="lazy"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full bg-white"
            />
          </div>
        </div>
        <dl className="space-y-4 text-[0.95rem]">
          <div>
            <dt className="text-muted text-sm">Dibuat oleh</dt>
            <dd className="flex items-center gap-2 font-semibold mt-1">
              {row.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatarUrl} alt="" width={26} height={26} className="rounded-full" />
              )}
              <a href={`https://github.com/${row.login}`} className="hover:underline" target="_blank" rel="noopener noreferrer">
                {row.name ?? row.login}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Dibangun dengan</dt>
            <dd className="font-semibold mt-1">{FRAMEWORK_LABEL[p.framework]}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Sumber</dt>
            <dd className="font-mono text-sm mt-1 break-all">{sourceLabel(p)}</dd>
          </div>
          {p.liveAt && (
            <div>
              <dt className="text-muted text-sm">Live sejak</dt>
              <dd className="font-semibold mt-1">
                {p.liveAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </article>
  );
}
