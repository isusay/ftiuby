import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { cookieName } from "@/lib/session";
import { randomSecret } from "@/lib/id";

export async function GET() {
  const state = randomSecret(16);
  const jar = await cookies();
  jar.set(cookieName("oauth_state"), state, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.githubClientId);
  url.searchParams.set("redirect_uri", `${env.appUrl}/api/auth/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return NextResponse.redirect(url);
}
