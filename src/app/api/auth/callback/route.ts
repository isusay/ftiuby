import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { cookieName, createSession } from "@/lib/session";
import { getAuthedUser } from "@/lib/github";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get(cookieName("oauth_state"))?.value;
  jar.delete(cookieName("oauth_state"));

  const fail = (reason: string) => NextResponse.redirect(`${env.appUrl}/dashboard?error=${encodeURIComponent(reason)}`);
  if (!code || !state || !expected || state !== expected) return fail("Sesi login kedaluwarsa. Coba masuk lagi.");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: `${env.appUrl}/api/auth/callback`,
    }),
    cache: "no-store",
  });
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
  if (!token?.access_token) return fail("GitHub menolak login. Coba lagi.");

  // Token hanya dipakai sekali untuk identitas; tidak disimpan.
  const gh = await getAuthedUser(token.access_token).catch(() => null);
  if (!gh) return fail("Gagal membaca profil GitHub.");

  const isAdmin = env.adminLogins.includes(gh.login.toLowerCase());
  const existing = await db.query.users.findFirst({ where: eq(users.githubId, gh.id) });

  let userId: string;
  if (existing) {
    await db
      .update(users)
      .set({
        login: gh.login,
        name: gh.name,
        avatarUrl: gh.avatar_url,
        ...(isAdmin ? { role: "ADMIN" as const, activatedAt: existing.activatedAt ?? new Date() } : {}),
      })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        githubId: gh.id,
        login: gh.login,
        name: gh.name,
        avatarUrl: gh.avatar_url,
        role: isAdmin ? "ADMIN" : "USER",
        activatedAt: isAdmin ? new Date() : null,
      })
      .returning({ id: users.id });
    userId = created.id;
  }

  await createSession(userId);
  return NextResponse.redirect(`${env.appUrl}/dashboard`);
}
