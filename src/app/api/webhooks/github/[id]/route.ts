import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/schema";
import { guardedDeploy } from "@/lib/deploy";

/** Webhook push GitHub → build ulang otomatis. Diverifikasi dengan HMAC SHA-256 per project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.text();
  if (body.length > 5_000_000) return new NextResponse("Payload too large", { status: 413 });

  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) return new NextResponse("Not found", { status: 404 });

  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", project.webhookSecret).update(body).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true, message: "Webhook terhubung" });
  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  let payload: { ref?: string; repository?: { id?: number; full_name?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Cocokkan lewat ID repo (tahan ganti nama); project lama tanpa repoId memakai nama.
  const repoMatches = project.repoId
    ? payload.repository?.id === project.repoId
    : payload.repository?.full_name?.toLowerCase() === `${project.repoOwner}/${project.repoName}`.toLowerCase();
  if (!repoMatches) return NextResponse.json({ ok: true, ignored: "repository lain" });
  if (payload.ref !== `refs/heads/${project.branch}`) return NextResponse.json({ ok: true, ignored: "branch lain" });

  // Hanya project yang sudah disetujui admin yang boleh build ulang otomatis.
  if (!["LIVE", "FAILED"].includes(project.status) || !project.dokployAppId) {
    return NextResponse.json({ ok: true, ignored: `status ${project.status}` });
  }
  if (project.lastDeployAt && Date.now() - project.lastDeployAt.getTime() < 30_000) {
    return NextResponse.json({ ok: true, ignored: "deploy terlalu rapat" });
  }

  const outcome = await guardedDeploy(project, "Push ke " + project.branch);
  if ("held" in outcome) return NextResponse.json({ ok: true, held: true, reason: outcome.reason });
  return NextResponse.json({ ok: true, deploying: true });
}
