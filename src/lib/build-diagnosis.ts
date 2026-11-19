/**
 * Terjemahkan log build yang gagal menjadi penjelasan singkat + langkah perbaikan.
 * Murni fungsi teks (tanpa I/O) supaya aturan baru langsung berlaku untuk log lama.
 */

export type Diagnosis = {
  /** Ringkasan penyebab, satu kalimat. */
  title: string;
  /** Langkah yang bisa dilakukan developer. */
  steps: string[];
  /** Baris log yang paling relevan (untuk disorot). */
  evidence: string | null;
};

type Rule = { re: RegExp; title: string; steps: string[] };

const RULES: Rule[] = [
  {
    re: /npm (?:ERR!|error) .*(?:can only install packages when your package\.json and package-lock\.json|are in sync)|Missing: .+ from lock file|ERR_PNPM_OUTDATED_LOCKFILE|lockfile.*(?:not up to date|out of date)/i,
    title: "Lockfile tidak sinkron dengan package.json.",
    steps: [
      "Jalankan npm install (atau pnpm install) di komputermu supaya lockfile diperbarui.",
      "Commit file package-lock.json (atau pnpm-lock.yaml) yang baru, lalu push atau unggah ulang.",
    ],
  },
  {
    re: /ERESOLVE|Could not resolve dependency|conflicting peer dependency|ERR_PNPM_PEER_DEP/i,
    title: "Versi dependency saling bertabrakan (peer dependency conflict).",
    steps: [
      "Jalankan npm install di komputermu dan baca dependency mana yang bentrok.",
      "Samakan versinya (misalnya perbarui atau turunkan paket yang disebut di log), lalu commit lockfile yang baru.",
    ],
  },
  {
    re: /JavaScript heap out of memory|FATAL ERROR: .*Allocation failed|ENOMEM|exit code:? 137|signal:? killed|\bKilled\b/i,
    title: "Proses build kehabisan memori.",
    steps: [
      "Kurangi ukuran aset yang di-import langsung oleh kode (model 3D, video, gambar besar). Pindahkan file besar ke folder public/ supaya tidak diproses bundler.",
      "Kompres model 3D (misalnya glTF dengan Draco/meshopt) dan gambar sebelum di-commit.",
      "Kalau sudah dikurangi dan masih gagal, minta admin menaikkan batas memori build.",
    ],
  },
  {
    re: /Cannot find module|Module not found|Could not resolve ["'].+["'] from|Failed to resolve import|Rollup failed to resolve import|ERR_MODULE_NOT_FOUND/i,
    title: "Ada file atau paket yang di-import tetapi tidak ditemukan.",
    steps: [
      "Periksa nama file di import: server build memakai Linux yang peka huruf besar-kecil (Model.glb ≠ model.glb).",
      "Pastikan file tersebut ikut di-commit (tidak masuk .gitignore) atau ada di dalam ZIP.",
      "Kalau yang hilang adalah paket npm, tambahkan dengan npm install nama-paket lalu commit lockfile.",
    ],
  },
  {
    re: /error TS\d{3,5}:/,
    title: "Ada error TypeScript yang menghentikan build.",
    steps: [
      "Jalankan npm run build di komputermu dan perbaiki error yang ditampilkan.",
      "Kalau script build menjalankan tsc lebih dulu (misalnya \"tsc && vite build\"), error tipe sekecil apa pun membuat build gagal.",
    ],
  },
  {
    re: /SyntaxError|Unexpected token|Expected .+ but found|Transform failed/i,
    title: "Ada kesalahan penulisan kode (syntax error).",
    steps: [
      "Buka file dan nomor baris yang disebut di log, lalu perbaiki kodenya.",
      "Pastikan npm run build berhasil di komputermu sebelum push atau unggah ulang.",
    ],
  },
  {
    re: /EBADENGINE|Unsupported engine|requires (?:a )?node(?:\.js)? (?:version )?[>=~^]|The engine "node" is incompatible/i,
    title: "Versi Node.js yang diminta project tidak cocok dengan server (Node 22).",
    steps: [
      "Periksa field \"engines\" di package.json dan dependency yang meminta versi Node tertentu.",
      "Gunakan versi paket yang mendukung Node 22, atau longgarkan batas \"engines\".",
    ],
  },
  {
    re: /(?:No such file or directory|ENOENT|not found|does not exist).*(?:\/dist|\/out|\/build|\.output)|publish ?directory|COPY failed|failed to compute cache key/i,
    title: "Folder hasil build tidak ditemukan.",
    steps: [
      "Pastikan perintah build menghasilkan folder yang benar: dist (Vite/Astro), out (Next.js export), build (SvelteKit), .output/public (Nuxt).",
      "Kalau kamu mengubah build.outDir/outDir di konfigurasi, kembalikan ke bawaan atau beri tahu admin.",
    ],
  },
  {
    re: /Repository not found|could not read Username|Authentication failed|fatal: (?:unable to access|could not read|remote error)|Remote branch .+ not found/i,
    title: "Server gagal mengambil kode dari repository.",
    steps: [
      "Pastikan repository masih public dan branch produksinya masih ada.",
      "Kalau repository diganti nama atau dipindah, kirim ulang pengajuan dari dashboard.",
    ],
  },
  {
    re: /ETIMEDOUT|EAI_AGAIN|ECONNRESET|ENOTFOUND|socket hang up|network (?:error|timeout)|429 Too Many Requests/i,
    title: "Koneksi jaringan terputus saat mengunduh dependency.",
    steps: ["Biasanya bersifat sementara. Tunggu beberapa menit lalu klik Build ulang."],
  },
  {
    re: /Missing script: "?(build|generate)"?/i,
    title: "Script build tidak ada di package.json.",
    steps: ["Tambahkan script \"build\" (atau \"generate\" untuk Nuxt) di package.json, lalu push atau unggah ulang."],
  },
];

const FALLBACK: Omit<Diagnosis, "evidence"> = {
  title: "Build gagal, penyebabnya belum dikenali otomatis.",
  steps: [
    "Baca bagian akhir log di bawah: baris berisi \"error\" biasanya menunjukkan penyebabnya.",
    "Jalankan npm ci lalu npm run build dari folder bersih di komputermu. Kalau di lokal berhasil, pastikan semua file dan lockfile sudah di-commit.",
  ],
};

/** Buang kode warna ANSI dan karakter kontrol, potong ke baris terakhir. */
export function cleanLog(raw: string, maxLines = 150, maxChars = 20_000): string {
  const text = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n");
  const lines = text.split("\n").slice(-maxLines).join("\n").trim();
  return lines.length > maxChars ? lines.slice(-maxChars) : lines;
}

export function diagnoseBuild(log: string | null | undefined): Diagnosis {
  const text = log ?? "";
  const lines = text.split("\n");
  for (const rule of RULES) {
    // Cari dari bawah: error terakhir biasanya penyebab sebenarnya.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (rule.re.test(lines[i])) {
        return { title: rule.title, steps: rule.steps, evidence: lines[i].trim().slice(0, 300) };
      }
    }
  }
  const lastError = [...lines].reverse().find((l) => /\berror\b|\bfailed\b|ERR!/i.test(l));
  return { ...FALLBACK, evidence: lastError?.trim().slice(0, 300) ?? null };
}
