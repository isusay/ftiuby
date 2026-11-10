import "server-only";
import { env } from "./env";

/** Subdomain: huruf kecil, angka, strip; 3–32 karakter; tidak diawali/diakhiri strip. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;

export function normalizeSlug(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function slugProblem(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return "Nama subdomain 3–32 karakter: huruf kecil, angka, dan strip.";
  if (slug.includes("--")) return "Nama subdomain tidak boleh berisi strip ganda.";
  if (env.reservedSlugs.includes(slug)) return `Nama "${slug}" sudah dipakai sistem. Pilih nama lain.`;
  return null;
}
