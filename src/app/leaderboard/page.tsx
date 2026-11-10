import { getCurrentUser } from "@/lib/session";
import { leaderboard } from "@/lib/queries";
import { env } from "@/lib/env";
import { ProjectCard } from "@/components/project-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Peringkat — ftiuby" };

export default async function Leaderboard() {
  const user = await getCurrentUser();
  const items = await leaderboard(60, user?.id);
  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-5xl font-extrabold mb-3">Peringkat</h1>
      <p className="text-muted mb-10 max-w-[60ch]">
        Diurutkan dari jumlah suka. Masuk dengan GitHub untuk menyukai karya teman — satu akun, satu suka per karya.
      </p>
      {items.length === 0 ? (
        <p className="panel p-8 text-center text-muted">Belum ada karya yang live.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p, i) => (
            <ProjectCard key={p.id} p={p} rank={i + 1} canLike={!!user} sitesDomain={env.sitesDomain} />
          ))}
        </div>
      )}
    </section>
  );
}
