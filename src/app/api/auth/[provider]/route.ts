import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { cookieName } from "@/lib/session";
import { randomSecret } from "@/lib/id";
import { oauthProviders } from "@/lib/oauth";
import type { GitProvider } from "@/lib/schema";

/** Mulai login (atau ?link=1: hubungkan akun provider ke user yang sedang login). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const p = oauthProviders[provider as GitProvider];
  if (!p || !p.enabled()) return NextResponse.redirect(`${env.appUrl}/dashboard?error=${encodeURIComponent("Provider login tidak tersedia.")}`);

  const mode = req.nextUrl.searchParams.get("link") === "1" ? "link" : "login";
  const state = randomSecret(16);
  const jar = await cookies();
  jar.set(cookieName("oauth_state"), `${provider}:${mode}:${state}`, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(p.authorizeUrl(state));
}
