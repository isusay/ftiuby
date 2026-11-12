import Link from "next/link";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panduan — ftiuby" };

const FORMATS = [
  ["HTML statis", "index.html di root", "Tanpa package.json. Semua CSS, JS, dan gambar ikut di-commit."],
  ["Vite", "dist/", "React, Vue, Svelte, atau vanilla. Script build wajib ada."],
  ["Astro", "dist/", "Mode output static (bawaan Astro)."],
  ["Next.js", "out/", "Wajib output: 'export' di next.config."],
  ["Nuxt", ".output/public/", "Script generate wajib ada (nuxt generate)."],
  ["SvelteKit", "build/", "Wajib memakai @sveltejs/adapter-static."],
];

const STATUSES = [
  ["Menunggu review", "Pengajuan sudah masuk. Admin akan meninjau repository-mu."],
  ["Perlu revisi", "Baca catatan admin di dashboard, perbaiki repo, lalu kirim ulang."],
  ["Sedang build", "Server sedang meng-clone dan membangun situsmu. Biasanya 1–5 menit."],
  ["Live", "Situsmu bisa dibuka dan tampil di galeri."],
  ["Build gagal", "Perbaiki error (biasanya script build atau folder output), lalu push lagi."],
  ["Diarsipkan", "Situs dimatikan dan slot terbuka lagi. Kamu bisa mengajukan ulang kapan saja."],
];

export default function Rules() {
  const d = env.sitesDomain;
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 grid gap-12 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block sticky top-24 self-start text-[0.95rem]" aria-label="Isi halaman">
        <p className="font-semibold mb-3">Di halaman ini</p>
        <ul className="space-y-2 text-muted">
          <li><a href="#syarat" className="hover:text-ink">Syarat</a></li>
          <li><a href="#format" className="hover:text-ink">Format yang didukung</a></li>
          <li><a href="#langkah" className="hover:text-ink">Langkah publish</a></li>
          <li><a href="#update" className="hover:text-ink">Update otomatis</a></li>
          <li><a href="#status" className="hover:text-ink">Arti status</a></li>
          <li><a href="#masalah" className="hover:text-ink">Masalah umum</a></li>
        </ul>
      </nav>

      <div className="max-w-[72ch] space-y-14">
        <header>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-4">Dari repository ke situs live.</h1>
          <p className="text-lg text-muted">
            ftiuby meng-host website statis secara gratis di <span className="font-mono">nama.{d}</span>. Situs statis
            cepat, aman, dan murah dijalankan — jadi slot bisa dibagi ke lebih banyak teman.
          </p>
        </header>

        <section id="syarat" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Syarat</h2>
          <ul className="space-y-3 list-disc pl-5">
            <li><strong>Akun GitHub atau GitLab</strong> untuk login. Keduanya bisa dihubungkan ke satu akun ftiuby.</li>
            <li><strong>Repository public milikmu sendiri</strong> (bukan milik organisasi/grup), atau <strong>file ZIP</strong> berisi website-mu (maks. 25 MB, tanpa <span className="font-mono">node_modules</span>).</li>
            <li><strong>Website statis.</strong> Tidak butuh server, database, atau API yang berjalan di backend.</li>
            <li><strong>Kode undangan</strong> untuk mengaktifkan akun selama masa beta.</li>
            <li>Setiap developer punya <strong>kuota beberapa website aktif</strong> (lihat di dashboard). Situs yang diarsipkan tidak memakai kuota.</li>
          </ul>
        </section>

        <section id="format" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Format yang didukung</h2>
          <p className="mb-5 text-muted">
            Untuk project Node, commit tepat satu lockfile: <code className="font-mono">package-lock.json</code> atau{" "}
            <code className="font-mono">pnpm-lock.yaml</code>.
          </p>
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-[0.95rem]">
              <thead className="border-b border-line">
                <tr>
                  <th className="p-3 font-semibold">Format</th>
                  <th className="p-3 font-semibold">Folder hasil build</th>
                  <th className="p-3 font-semibold">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {FORMATS.map(([f, o, n]) => (
                  <tr key={f} className="border-b border-line last:border-0 align-top">
                    <td className="p-3 font-semibold whitespace-nowrap">{f}</td>
                    <td className="p-3 font-mono text-sm whitespace-nowrap">{o}</td>
                    <td className="p-3 text-muted">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5">
            <strong>Belum didukung:</strong> backend (Express, Laravel, PHP, WordPress), SSR, API route, Docker, database,
            dan Create React App. Untuk project React baru, pakai Vite.
          </p>
        </section>

        <section id="langkah" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Langkah publish</h2>
          <ol className="space-y-5">
            {[
              ["Masuk ke Dashboard", "Login dengan GitHub atau GitLab, lalu masukkan kode undangan jika akunmu belum aktif."],
              ["Pilih sumber kode", "Pilih repository dan branch dari GitHub/GitLab (daftarnya muncul otomatis), atau unggah file ZIP."],
              ["Cek hasil pemeriksaan", "Sistem mendeteksi framework, folder output, dan masalah struktur sebelum kamu mengirim."],
              ["Tunggu review dan build", "Setelah admin menyetujui, server membangun situsmu di container terisolasi."],
              ["Bagikan alamatmu", `Saat status Live, situsmu terbuka di nama-pilihanmu.${d}.`],
            ].map(([t, x], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-display text-3xl font-extrabold text-accent leading-none w-7 shrink-0">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-bold">{t}</h3>
                  <p className="text-muted">{x}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="update" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Update otomatis saat push</h2>
          <p className="mb-3">
            Setelah situsmu disetujui, dashboard menampilkan <strong>alamat webhook</strong> dan <strong>secret</strong>.
            Pasang sekali dan setiap push ke branch produksi akan membangun ulang situsmu:
          </p>
          <ol className="list-decimal pl-5 space-y-1.5 mb-3">
            <li><strong>GitHub:</strong> repository → Settings → Webhooks → Add webhook. Isi Payload URL dan Secret, content type <span className="font-mono">application/json</span>, pilih &quot;Just the push event&quot;.</li>
            <li><strong>GitLab:</strong> project → Settings → Webhooks → Add new webhook. Isi URL dan Secret token, centang &quot;Push events&quot;.</li>
            <li><strong>Upload ZIP:</strong> unggah versi baru dari dashboard.</li>
          </ol>
          <p className="text-muted mb-2">
            Perubahan isi halaman langsung tayang. Perubahan <span className="font-mono">package.json</span>, lockfile, atau file
            konfigurasi build ditinjau admin dulu, karena kode tersebut dijalankan di server kami.
          </p>
          <p className="text-muted">Kalau build versi baru gagal, versi lama tetap tayang.</p>
        </section>

        <section id="status" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Arti status</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            {STATUSES.map(([s, x]) => (
              <div key={s} className="panel p-4">
                <dt className="font-bold mb-1">{s}</dt>
                <dd className="text-muted text-[0.95rem]">{x}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="masalah" className="scroll-mt-24">
          <h2 className="text-3xl font-extrabold mb-4">Masalah umum</h2>
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold mb-1">Gambar atau CSS tidak muncul di situs HTML</h3>
              <p className="text-muted">
                Pastikan semua file sudah di-commit dan path-nya relatif, misalnya <code className="font-mono">./style.css</code>.
                Nama file peka huruf besar-kecil: <code className="font-mono">Logo.png</code> berbeda dengan{" "}
                <code className="font-mono">logo.png</code>.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-1">Build Vite, Astro, atau framework lain gagal</h3>
              <p className="text-muted">
                Jalankan <code className="font-mono">npm ci &amp;&amp; npm run build</code> di komputermu dari folder bersih. Kalau di
                lokal lancar, pastikan lockfile terbaru sudah di-commit.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-1">Dependency ditolak</h3>
              <p className="text-muted">
                Demi keamanan, dependency harus dari npm registry resmi. Dependency dari Git, URL, file lokal, atau workspace ditolak.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-1">Masih butuh bantuan?</h3>
              <p className="text-muted">
                Hubungi admin dengan menyertakan URL repository dan branch (atau nama subdomain untuk upload ZIP). Jangan pernah mengirim token atau password ke siapa pun.
              </p>
            </div>
          </div>
        </section>

        <div className="panel p-8">
          <h2 className="text-3xl font-extrabold mb-2">Siap publish?</h2>
          <p className="text-muted mb-5">Mulai dari repository GitHub/GitLab atau file ZIP yang sudah rapi.</p>
          <Link href="/dashboard" className="btn btn-primary">Buka dashboard</Link>
        </div>
      </div>
    </div>
  );
}
