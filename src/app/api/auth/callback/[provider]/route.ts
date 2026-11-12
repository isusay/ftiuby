import type { NextRequest } from "next/server";
import { handleOAuthCallback } from "@/lib/auth-flow";

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  return handleOAuthCallback((await ctx.params).provider, req);
}
