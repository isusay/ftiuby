import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { ThemeToggle } from "./theme-toggle";

export async function Header() {
  const user = await getCurrentUser().catch(() => null);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4">
        <Link href="/" className="font-display text-2xl font-extrabold tracking-tight" aria-label="ftiuby beranda">
          ftiuby<span className="text-accent">.</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-1 text-[0.95rem] ml-4" aria-label="Navigasi utama">
          <Link href="/" className="px-3 py-2 rounded-md hover:bg-surface">Jelajahi</Link>
          <Link href="/leaderboard" className="px-3 py-2 rounded-md hover:bg-surface">Peringkat</Link>
          <Link href="/rules" className="px-3 py-2 rounded-md hover:bg-surface">Panduan</Link>
          {user?.role === "ADMIN" && (
            <Link href="/admin" className="px-3 py-2 rounded-md hover:bg-surface">Admin</Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Link href="/dashboard" className="flex items-center gap-2 btn btn-ghost btn-sm">
              {user.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" width={22} height={22} className="rounded-full" />
              )}
              <span className="max-w-[10ch] truncate">{user.login}</span>
            </Link>
          ) : (
            <a href="/dashboard" className="btn btn-ghost btn-sm">Masuk</a>
          )}
          <Link href="/dashboard" className="btn btn-primary btn-sm hidden sm:inline-flex">Publish web</Link>
        </div>
      </div>
      <nav className="sm:hidden flex border-t border-line text-sm" aria-label="Navigasi seluler">
        <Link href="/" className="flex-1 text-center py-2.5">Jelajahi</Link>
        <Link href="/leaderboard" className="flex-1 text-center py-2.5">Peringkat</Link>
        <Link href="/rules" className="flex-1 text-center py-2.5">Panduan</Link>
        <Link href="/dashboard" className="flex-1 text-center py-2.5 font-semibold text-accent">Publish</Link>
      </nav>
    </header>
  );
}
