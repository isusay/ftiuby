import "server-only";
import { env } from "./env";

/**
 * Situs pengguna di *.ftiuby.cloud dianggap "same-site" oleh browser, jadi cookie
 * SameSite=Lax tetap ikut terkirim. Semua route POST wajib cek Origin persis = APP_URL.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === new URL(env.appUrl).origin;
}
