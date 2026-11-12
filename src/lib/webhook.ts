import "server-only";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { projects, type GitProvider } from "./schema";
import { guardedDeploy, isGitProject } from "./deploy";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Push = { ref?: string; repoId?: number; repoPath?: string };

const PROVIDERS: Record<GitProvider, {
  verify(req: Request, body: string, secret: string): boolean;
  event(req: Request): "ping" | "push" | string | null;
  parse(payload: unknown): Push;
}> = {
  github: {
    // HMAC SHA-256 atas body dengan secret per project.
    verify: (req, body, secret) =>
      safeEqual(req.headers.get("x-hub-signature-256") ?? "", "sha256=" + createHmac("sha256", secret).update(body).digest("hex")),
    event: (req) => req.headers.get("x-github-event"),
    parse: (p) => {
      const x = p as { ref?: string; repository?: { id?: number; full_name?: string } };
      return { ref: x.ref, repoId: x.repository?.id, repoPath: x.repository?.full_name };
    },
  },
  gitlab: {
    // GitLab mengirim secret token apa adanya di header X-Gitlab-Token.
    verify: (req, _body, secret) => safeEqual(req.headers.get("x-gitlab-token") ?? "", secret),
    event: (req) => {
      const e = req.headers.get("x-gitlab-event");
      return e === "Push Hook" ? "push" : e;
    },
    parse: (p) => {
      const x = p as { ref?: string; project?: { id?: number; path_with_namespace?: string }; project_id?: number };
      return { ref: x.ref, repoId: x.project?.id ?? x.project_id, repoPath: x.project?.path_with_namespace };
    },
  },
};

/** Webhook push → build ulang otomatis (lewat gerbang review file build). */
export async function handlePushWebhook(provider: GitProvider, req: Request, id: string) {
  const cfg = PROVIDERS[provider];
  const body = await req.text();
  if (body.length > 5_000_000) return new NextResponse("Payload too large", { status: 413 });

  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project || project.provider !== provider) return new NextResponse("Not found", { status: 404 });
  if (!cfg.verify(req, body, project.webhookSecret)) return new NextResponse("Invalid signature", { status: 401 });

  const event = cfg.event(req);
  if (event === "ping") return NextResponse.json({ ok: true, message: "Webhook terhubung" });
  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  let push: Push;
  try {
    push = cfg.parse(JSON.parse(body));
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  if (!isGitProject(project)) return NextResponse.json({ ok: true, ignored: "bukan project git" });

  // Cocokkan lewat ID repo (tahan ganti nama); project lama tanpa repoId memakai path.
  const repoMatches = project.repoId
    ? push.repoId === project.repoId
    : push.repoPath?.toLowerCase() === project.repoPath.toLowerCase();
  if (!repoMatches) return NextResponse.json({ ok: true, ignored: "repository lain" });
  if (push.ref !== `refs/heads/${project.branch}`) return NextResponse.json({ ok: true, ignored: "branch lain" });

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
