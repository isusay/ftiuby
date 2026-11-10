import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";
import { isSameOrigin } from "@/lib/origin";
import { toggleLike } from "@/lib/queries";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Masuk dulu untuk menyukai karya." }, { status: 401 });
  const { id } = await ctx.params;
  const p = await db.query.projects.findFirst({ where: and(eq(projects.id, id), eq(projects.status, "LIVE")) });
  if (!p) return NextResponse.json({ error: "Karya tidak ditemukan." }, { status: 404 });
  if (p.userId === user.id) return NextResponse.json({ error: "Karya sendiri tidak bisa disukai." }, { status: 400 });
  return NextResponse.json(await toggleLike(user.id, id));
}
