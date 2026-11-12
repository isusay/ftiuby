import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { accounts, users, type User } from "./schema";
import { isAdminIdentity } from "./oauth";

/**
 * Cookie memakai prefix __Host- di production: wajib Secure, Path=/, tanpa Domain.
 * Ini mencegah situs pengguna di *.ftiuby.cloud menimpa cookie sesi milik ftiuby.cloud.
 */
export function cookieName(base: string) {
  return env.isProd ? `__Host-${base}` : base;
}

const SESSION = "ftiuby_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function key() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  const jar = await cookies();
  jar.set(cookieName(SESSION), token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(cookieName(SESSION));
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(cookieName(SESSION))?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user) return null;
    // Admin yang dihapus dari ADMIN_LOGINS langsung kehilangan akses,
    // tanpa menunggu sesinya (30 hari) habis atau login ulang.
    if (
      user.role === "ADMIN" &&
      !isAdminIdentity(await db.query.accounts.findMany({ where: eq(accounts.userId, user.id) }))
    ) {
      await db.update(users).set({ role: "USER" }).where(eq(users.id, user.id));
      return { ...user, role: "USER" };
    }
    return user;
  } catch {
    return null;
  }
}

export class AuthError extends Error {}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Masuk dulu dengan GitHub.");
  return user;
}

export async function requireActiveUser(): Promise<User> {
  const user = await requireUser();
  if (!user.activatedAt) throw new AuthError("Akun belum aktif. Masukkan kode undangan dulu.");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("Halaman ini khusus admin.");
  return user;
}
