import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { syncProject } from "@/lib/deploy";

/** Dipoll dashboard selama build berlangsung. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const p = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!p || (p.userId !== user.id && user.role !== "ADMIN")) return new NextResponse("Not found", { status: 404 });
  const s = await syncProject(p);
  return NextResponse.json({ status: s.status, deployState: s.deployState });
}
