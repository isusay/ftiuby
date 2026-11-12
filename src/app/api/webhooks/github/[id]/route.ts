import { handlePushWebhook } from "@/lib/webhook";

/** Webhook push GitHub, diverifikasi HMAC SHA-256 per project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handlePushWebhook("github", req, (await ctx.params).id);
}
