import "server-only";
import { createHash } from "node:crypto";
import { Unzip, UnzipInflate, strFromU8, zipSync } from "fflate";
import { analyzeSource, type PreflightResult } from "./preflight";

export const MAX_ZIP_BYTES = 25 * 1024 * 1024; // ukuran ZIP yang diunggah
const MAX_UNZIPPED_BYTES = 150 * 1024 * 1024; // total setelah diekstrak (cegah zip bomb)
const MAX_FILES = 5000;

export class ArchiveError extends Error {}

/**
 * Ekstrak ZIP dengan aman: batas jumlah file & total ukuran dihitung saat streaming
 * (bukan dari header yang bisa dipalsukan), path berbahaya ditolak, folder induk tunggal
 * dibuang (ZIP hasil "compress folder"), dan file sampah OS dilewati.
 */
export function extractZip(buf: Uint8Array): Map<string, Uint8Array> {
  if (buf.byteLength > MAX_ZIP_BYTES) throw new ArchiveError("File ZIP maksimal 25 MB.");
  if (buf.byteLength < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ArchiveError("File bukan ZIP yang valid.");

  const raw = new Map<string, Uint8Array>();
  let total = 0;
  let problem: string | null = null;

  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (f) => {
    if (problem) return;
    const name = f.name.replace(/\\/g, "/");
    if (name.endsWith("/")) return; // folder
    const parts = name.split("/");
    if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || parts.some((p) => p === ".." || p === "")) {
      problem = `Path tidak aman di dalam ZIP: ${f.name}`;
      return;
    }
    if (parts[0] === "__MACOSX" || parts.at(-1) === ".DS_Store" || parts.at(-1) === "Thumbs.db") return;
    if (raw.size >= MAX_FILES) {
      problem = `ZIP berisi lebih dari ${MAX_FILES} file.`;
      return;
    }
    const chunks: Uint8Array[] = [];
    f.ondata = (err, data, final) => {
      if (problem) return;
      if (err) {
        problem = "ZIP rusak atau memakai kompresi yang tidak didukung.";
        return;
      }
      total += data.byteLength;
      if (total > MAX_UNZIPPED_BYTES) {
        problem = "Isi ZIP terlalu besar setelah diekstrak (maksimal 150 MB).";
        f.terminate();
        return;
      }
      chunks.push(data);
      if (final) raw.set(name, concat(chunks));
    };
    f.start();
  };
  try {
    uz.push(buf, true);
  } catch {
    problem ??= "ZIP rusak atau memakai kompresi yang tidak didukung.";
  }
  if (problem) throw new ArchiveError(problem);
  if (raw.size === 0) throw new ArchiveError("ZIP kosong.");

  // Buang satu folder induk bila semua file ada di dalamnya.
  const roots = new Set([...raw.keys()].map((k) => (k.includes("/") ? k.split("/")[0] : "")));
  if (roots.size === 1 && !roots.has("")) {
    const prefix = [...roots][0] + "/";
    return new Map([...raw].map(([k, v]) => [k.slice(prefix.length), v]));
  }
  return raw;
}

function concat(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

const sha256 = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

export type PreparedUpload = {
  /** ZIP baru yang sudah dinormalisasi (hanya file biasa, tanpa symlink/atribut). */
  zip: Buffer;
  sha256: string;
  fileCount: number;
  preflight: PreflightResult;
};

/** Ekstrak, periksa seperti repo git, lalu kemas ulang menjadi ZIP bersih untuk Dokploy. */
export async function prepareUpload(buf: Uint8Array): Promise<PreparedUpload> {
  const files = extractZip(buf);
  const preflight = await analyzeSource({
    files: [...files].map(([path, data]) => ({ path, sha: sha256(data) })),
    truncated: false,
    hasSubmodules: false,
    read: async (path) => {
      const d = files.get(path);
      return d && d.byteLength <= 512_000 ? strFromU8(d) : null;
    },
  });
  const sorted = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
  const zip = Buffer.from(zipSync(sorted, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") }));
  return { zip, sha256: sha256(zip), fileCount: files.size, preflight };
}

/** Periksa ulang ZIP yang tersimpan (sudah dinormalisasi) saat admin meninjau. */
export async function inspectStoredZip(buf: Uint8Array): Promise<PreflightResult> {
  return (await prepareUpload(buf)).preflight;
}
