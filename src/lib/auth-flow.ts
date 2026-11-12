import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { and, asc, eq } from "drizzle-orm";
import { env } from "./env";
import { db } from "./db";
import { accounts, users, type GitProvider } from "./schema";
import { cookieName, createSession, getCurrentUser } from "./session";
import { isAdminIdentity, oauthProviders, type OAuthProfile } from "./oauth";

/**
 * Hitung ulang data turunan user dari akun-akunnya: role admin (mengikuti env, bisa naik/turun),
 * aktivasi otomatis admin, serta nama & avatar tampilan (utamakan GitHub, lalu akun tertua).
 */
export async function syncUserFromAccounts(userId: string) {
  const accts = await db.query.accounts.findMany({ where: eq(accounts.userId, userId), orderBy: asc(accounts.createdAt) });
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || accts.length === 0) return;
  const primary = accts.find((a) => a.provider === "github") ?? accts[0];
  const admin = isAdminIdentity(accts);
  await db
    .update(users)
    .set({
      login: primary.login,
      avatarUrl: primary.avatarUrl,
      role: admin ? "ADMIN" : "USER",
      ...(admin && !user.activatedAt ? { activatedAt: new Date() } : {}),
    })
    .where(eq(users.id, userId));
}

async function upsertAccountInfo(id: string, p: OAuthProfile) {
  await db.update(accounts).set({ login: p.login, avatarUrl: p.avatarUrl }).where(eq(accounts.id, id));
}

export async function handleOAuthCallback(providerParam: string, req: NextRequest) {
  const fail = (reason: string) => NextResponse.redirect(`${env.appUrl}/dashboard?error=${encodeURIComponent(reason)}`);
  const provider = providerParam as GitProvider;
  const oauth = oauthProviders[provider];
  if (!oauth || !oauth.enabled()) return fail("Provider login tidak tersedia.");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const saved = jar.get(cookieName("oauth_state"))?.value ?? "";
  jar.delete(cookieName("oauth_state"));
  const [savedProvider, mode, savedState] = saved.split(":");
  if (!code || !state || !savedState || state !== savedState || savedProvider !== provider) {
    return fail("Sesi login kedaluwarsa. Coba masuk lagi.");
  }

  // Token hanya dipakai sekali untuk membaca identitas; tidak disimpan.
  const profile = await oauth.profile(code).catch(() => null);
  if (!profile) return fail(`${oauth.label} menolak login. Coba lagi.`);

  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.provider, provider), eq(accounts.providerAccountId, profile.providerAccountId)),
  });

  /* ----- Hubungkan akun ke user yang sedang login ----- */
  if (mode === "link") {
    const current = await getCurrentUser();
    if (!current) return fail("Masuk dulu sebelum menghubungkan akun.");
    if (existing && existing.userId !== current.id) {
      return fail(`Akun ${oauth.label} @${profile.login} sudah terhubung ke pengguna lain.`);
    }
    if (existing) {
      await upsertAccountInfo(existing.id, profile);
    } else {
      const other = await db.query.accounts.findFirst({
        where: and(eq(accounts.userId, current.id), eq(accounts.provider, provider)),
      });
      if (other) return fail(`Kamu sudah menghubungkan akun ${oauth.label} lain (@${other.login}). Putuskan dulu.`);
      await db.insert(accounts).values({ userId: current.id, ...profile });
    }
    await syncUserFromAccounts(current.id);
    return NextResponse.redirect(`${env.appUrl}/dashboard?linked=${provider}`);
  }

  /* ----- Login / daftar ----- */
  let userId: string;
  if (existing) {
    await upsertAccountInfo(existing.id, profile);
    userId = existing.userId;
  } else {
    userId = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ login: profile.login, name: profile.name, avatarUrl: profile.avatarUrl })
        .returning({ id: users.id });
      await tx.insert(accounts).values({ userId: u.id, ...profile });
      return u.id;
    });
  }
  if (profile.name) await db.update(users).set({ name: profile.name }).where(eq(users.id, userId));
  await syncUserFromAccounts(userId);
  await createSession(userId);
  return NextResponse.redirect(`${env.appUrl}/dashboard`);
}
