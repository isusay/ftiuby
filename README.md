# ftiuby

Galeri dan hosting gratis untuk website statis karya komunitas ftiuby. Developer login dengan GitHub atau GitLab, memilih repository public (atau mengunggah ZIP), sistem memeriksa strukturnya, admin meninjau, lalu situs di-build dan tayang di `nama.ftiuby.cloud` — semuanya lewat API Dokploy.

**Fitur**
- Login GitHub atau GitLab (OAuth, hanya scope baca profil, token tidak disimpan); beberapa provider bisa dihubungkan ke satu akun
- Sumber kode: repository GitHub, repository GitLab, atau upload ZIP (sumber "Drop" Dokploy)
- Kode undangan + slot beta terbatas
- Preflight otomatis: deteksi HTML / Vite / Astro / Next.js export / Nuxt generate / SvelteKit static, cek lockfile, tolak dependency non-npm, tolak CRA/PHP/backend
- Review admin: setujui (otomatis buat aplikasi + domain + SSL di Dokploy), minta revisi dengan catatan, build ulang, arsipkan
- Beberapa website aktif per developer (`MAX_PROJECTS_PER_USER`, bisa diubah admin per pengguna); arsip membuka kuota dan menghapus aplikasi di Dokploy
- Auto-redeploy saat push lewat webhook GitHub (HMAC SHA-256) atau GitLab (secret token) per project, dan upload ZIP versi baru; ditahan untuk ditinjau admin bila file build berubah
- Galeri dengan filter kategori, halaman detail dengan pratinjau, peringkat berdasarkan suka
- Tema terang/gelap, responsif

**Stack:** Next.js 15 (App Router) · Drizzle ORM · PostgreSQL · Tailwind CSS 4 · Docker

---

## Cara deploy di Dokploy

### 1. DNS

Arahkan dua record ke IP server Dokploy:

| Tipe | Nama | Nilai |
|---|---|---|
| A | `ftiuby.cloud` (atau `@`) | IP server |
| A | `*.ftiuby.cloud` (wildcard) | IP server |

Wildcard membuat setiap `nama.ftiuby.cloud` langsung menuju Traefik di Dokploy. SSL tiap subdomain dibuat otomatis oleh Let's Encrypt saat situs disetujui.

Kalau dashboard Dokploy memakai subdomain `ftiuby.cloud` juga (misal `panel.ftiuby.cloud`), tambahkan namanya ke `RESERVED_SLUGS` supaya tidak bisa diklaim pengguna. `dokploy`, `panel`, `admin`, `www`, dan beberapa nama sistem lain sudah diblokir bawaan.

### 2. GitHub OAuth App

1. Buka github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. Homepage URL: `https://ftiuby.cloud`
3. Authorization callback URL: `https://ftiuby.cloud/api/auth/callback`
4. Simpan **Client ID** dan buat **Client Secret**

Disarankan juga membuat fine-grained personal access token **tanpa permission apa pun** (hanya akses public repo) untuk `GITHUB_TOKEN`, supaya limit GitHub API naik dari 60 ke 5000 request/jam.

### 2b. GitLab Application (opsional)

1. Buka gitlab.com → Preferences → **Applications** → Add new application
2. Redirect URI: `https://ftiuby.cloud/api/auth/callback/gitlab`
3. Confidential: ya · Scope: **read_user** saja
4. Simpan **Application ID** ke `GITLAB_CLIENT_ID` dan **Secret** ke `GITLAB_CLIENT_SECRET`

Provider yang client ID/secret-nya kosong tidak ditampilkan. Admin ditentukan lewat `ADMIN_LOGINS`, misalnya `github:alice,gitlab:bob`.

### 3. Siapkan Dokploy

1. **Project untuk webapp**, misal `ftiuby`. Di dalamnya buat **Database → PostgreSQL**. Salin *Internal Connection URL*-nya untuk `DATABASE_URL`.
2. **Project untuk situs pengguna**, misal `ftiuby-sites`. Biarkan kosong — aplikasi di dalamnya dibuat otomatis oleh webapp. Pisahkan dari project webapp supaya rapi.
3. **API key**: Settings → Profile → API/CLI → Generate. Simpan untuk `DOKPLOY_API_KEY`.

### 4. Deploy webapp

1. Push folder ini ke repository GitHub milikmu.
2. Di project `ftiuby`, buat **Application** → sumber GitHub (atau Git) → pilih repository ini.
3. Build type: **Dockerfile** (file `Dockerfile` sudah tersedia).
4. Tab **Environment**: isi semua variabel dari `.env.example`. Untuk sementara `DOKPLOY_ENVIRONMENT_ID` boleh diisi apa saja.
5. Tab **Domains**: tambah `ftiuby.cloud`, port container **3000**, HTTPS aktif, sertifikat Let's Encrypt.
6. Klik **Deploy**. Migrasi database berjalan otomatis setiap container start.

### 5. Hubungkan environment situs pengguna

1. Buka `https://ftiuby.cloud`, login dengan akun yang tercantum di `ADMIN_LOGINS`.
2. Masuk **Admin → Koneksi Dokploy → Uji koneksi**. Tabel menampilkan semua project dan environment beserta ID-nya.
3. Salin ID environment milik project `ftiuby-sites` ke `DOKPLOY_ENVIRONMENT_ID`, lalu **Redeploy** webapp.

### 6. Mulai beta

Admin → **Kode undangan** → buat kode (bisa sekali pakai atau banyak, dengan tanggal kedaluwarsa). Bagikan ke developer.

---

## Alur kerja

```
Developer                     ftiuby                            Dokploy
─────────                     ──────                            ───────
Login GitHub/GitLab ────────▶ akun dibuat (belum aktif)
Masukkan kode undangan ─────▶ akun aktif (memakai 1 slot)
Pilih repo + branch / ZIP ──▶ preflight (baca struktur kode)
Kirim pengajuan ────────────▶ status: Menunggu review
                              Admin klik "Setujui & deploy"
                              preflight ulang ────────────────▶ application.create
                                                                domain.create (nama.ftiuby.cloud, SSL)
                                                                saveGitProvider (git) / dropDeployment (ZIP)
                                                                saveBuildType (static / nixpacks)
                                                                application.deploy
                              status: Sedang build ◀─────────── applicationStatus (dipoll)
                              status: Live
git push ──▶ webhook ───────▶ verifikasi HMAC / token
                              file build sama dgn yg ditinjau? ─ya─▶ application.deploy
                              tidak → "Update tertahan" (admin: Tinjau & build ulang)
```

**Cara build per format:**
- HTML statis → build type `static` (Nginx menyajikan isi repo apa adanya)
- Vite, Astro, Next.js export, Nuxt, SvelteKit → build type `nixpacks` dengan `publishDirectory` = folder output; perintah build diteruskan lewat `NIXPACKS_BUILD_CMD`. Hasilnya disajikan sebagai file statis.

Kalau build versi baru gagal, container lama tetap berjalan sehingga situs tetap tayang.

---

## Keamanan

- **Cookie sesi** memakai prefix `__Host-` di production: hanya berlaku di `ftiuby.cloud`, tidak bisa ditimpa oleh situs pengguna di subdomain.
- **CSRF dari subdomain:** situs pengguna di `*.ftiuby.cloud` dianggap *same-site* oleh browser. Semua aksi yang mengubah data memverifikasi header `Origin` (server actions Next.js melakukannya bawaan; route POST memakai `isSameOrigin`).
- **Token GitHub** dari login hanya dipakai sekali untuk membaca profil, tidak disimpan.
- **Gerbang review untuk update.** Saat disetujui, sistem menyimpan *fingerprint* file yang menentukan proses install/build (`package.json`, lockfile, `.npmrc`, `nixpacks.toml`, `*.config.*`, `*rc.js`, file `.js/.ts` di root, folder `scripts/`). Push atau "Build ulang" dari developer hanya di-deploy otomatis bila fingerprint itu tidak berubah; bila berubah, update masuk tab **Admin → Update tertahan** dengan link diff ke GitHub. HTML statis tidak menjalankan kode saat build sehingga selalu di-deploy otomatis. Project yang dibuat sebelum fitur ini akan tertahan sekali pada push pertama sampai admin meninjaunya.
- **Kepemilikan repo** dilacak lewat ID numerik di provider (repo dan pemilik), bukan username, sehingga ganti nama atau username yang diambil orang lain tidak bisa membajak build. Repo yang dipindah ke pemilik lain otomatis ditahan. Repo milik organisasi (GitHub) atau grup (GitLab) belum didukung.
- **Upload ZIP** diekstrak dengan batas 25 MB terkompresi / 150 MB terekstrak / 5000 file (dihitung saat ekstraksi, bukan dari header), path absolut atau `..` ditolak, lalu dikemas ulang tanpa symlink sebelum dikirim ke Dokploy. ZIP disimpan di Postgres; admin bisa mengunduhnya untuk ditinjau.
- **Admin** mengikuti `ADMIN_LOGINS` setiap request: akun yang dihapus dari daftar langsung kehilangan akses admin.
- **Kode pengguna di-build di server Dokploy-mu.** Review admin adalah pengaman utama. Gerbang di atas tidak menangkap kode yang dieksekusi saat build dari file biasa (misalnya halaman SSG Astro/Next), jadi build server terpisah tetap sangat disarankan — periksa repo sebelum menyetujui, terutama script `build` dan `postinstall` di `package.json`. Atur `SITE_MEMORY_LIMIT` dan `SITE_CPU_LIMIT`, dan pertimbangkan *build server* terpisah di Dokploy (`DOKPLOY_SERVER_ID`) bila jumlah pengguna bertambah.
- **Pratinjau** di halaman detail memakai iframe `sandbox="allow-scripts"` tanpa `allow-same-origin`.

---

## Pengembangan lokal

```bash
cp .env.example .env      # isi nilainya; APP_URL=http://localhost:3000
npm install
npm run db:migrate
npm run dev
```

Setelah mengubah `src/lib/schema.ts`, buat migrasi baru dengan `npm run db:generate`.

## Struktur

```
src/lib/
  preflight.ts   pemeriksaan repo & deteksi framework
  dokploy.ts     klien REST API Dokploy
  deploy.ts      provisioning, sinkron status, arsip
  git/           antarmuka provider git (GitHub & GitLab) yang seragam
  github.ts      GitHub API (repo public, branch, tree, file)
  gitlab.ts      GitLab API v4
  oauth.ts       login OAuth per provider; auth-flow.ts: login & hubungkan akun
  archive.ts     ekstraksi & pemeriksaan ZIP (Drop)
  webhook.ts     webhook push GitHub/GitLab
  session.ts     sesi JWT dalam cookie
  schema.ts      skema database (Drizzle)
src/app/
  page.tsx                 galeri + hero
  leaderboard/             peringkat
  rules/                   panduan
  projects/[slug]/         detail karya
  dashboard/               invite, ajukan, kelola website
  admin/                   review, undangan, pengguna, koneksi Dokploy
  api/webhooks/{github,gitlab}/  auto-redeploy saat push
drizzle/                   migrasi SQL
```
