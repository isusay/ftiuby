import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { latestLive, slotStats, CATEGORIES } from "@/lib/queries";
import { env } from "@/lib/env";
import { ProjectCard } from "@/components/project-card";
import { SubdomainComposer } from "@/components/subdomain-composer";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ kategori?: string }> }) {
  const { kategori } = await searchParams;
  const category = CATEGORIES.find((c) => c === kategori);
  const user = await getCurrentUser();
  const [items, slots] = await Promise.all([latestLive(12, user?.id, category), slotStats()]);

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:pt-20">
        <p className="text-lg text-muted mb-5 max-w-[46ch]">
          Hosting gratis untuk website statis karya mahasiswa. Hubungkan repository GitHub, kami build, dan situsmu tayang di
        </p>
        <SubdomainComposer domain={env.sitesDomain} />
        <p className="mt-6 text-muted">
          {slots.available > 0 ? (
            <>
              <strong className="text-ink">{slots.available} dari {slots.total}</strong> slot beta masih terbuka · {slots.live} karya sudah live
            </>
          ) : (
            <>Slot beta sedang penuh. Kamu tetap bisa menjelajahi {slots.live} karya yang sudah live.</>
          )}
        </p>
      </section>

      <section className="border-y border-line bg-surface/70">
        <ol className="mx-auto max-w-6xl px-4 py-10 grid gap-8 sm:grid-cols-3">
          {[
            ["Hubungkan repository", "Masuk dengan GitHub dan pilih repository public berisi website-mu."],
            ["Cek otomatis & review", "Sistem membaca struktur repo, lalu admin meninjau sebelum build."],
            ["Tayang di subdomain", "Situsmu live di nama.ftiuby.cloud dan ikut tampil di galeri."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="font-display text-4xl font-extrabold text-accent leading-none">{i + 1}</span>
              <div>
                <h2 className="text-lg font-bold mb-1">{t}</h2>
                <p className="text-muted text-[0.95rem]">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <h2 className="text-4xl font-extrabold">Karya terbaru</h2>
          <Link href="/leaderboard" className="font-semibold text-accent hover:underline underline-offset-4">Lihat peringkat</Link>
        </div>
        <nav className="flex flex-wrap gap-2 mb-8" aria-label="Filter kategori">
          <Link href="/" className={`rounded-full border px-3 py-1 text-sm ${!category ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}>
            Semua
          </Link>
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/?kategori=${encodeURIComponent(c)}`}
              className={`rounded-full border px-3 py-1 text-sm ${category === c ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
            >
              {c}
            </Link>
          ))}
        </nav>
        {items.length === 0 ? (
          <div className="panel p-10 text-center">
            <p className="text-lg font-semibold mb-2">{category ? `Belum ada karya di kategori ${category}.` : "Belum ada karya yang live."}</p>
            <p className="text-muted mb-5">Jadilah yang pertama memajang karya di sini.</p>
            <Link href="/dashboard" className="btn btn-primary">Publish web</Link>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <ProjectCard key={p.id} p={p} canLike={!!user} sitesDomain={env.sitesDomain} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
