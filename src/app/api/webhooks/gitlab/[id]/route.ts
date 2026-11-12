import { handlePushWebhook } from "@/lib/webhook";

/** Webhook push GitLab, diverifikasi lewat X-Gitlab-Token per project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handlePushWebhook("gitlab", req, (await ctx.params).id);
}
