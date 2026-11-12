import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploads } from "@/lib/schema";
import { getCurrentUser } from "@/lib/session";

/** Unduh ZIP yang diunggah, untuk ditinjau admin (atau pemiliknya). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const up = await db.query.uploads.findFirst({ where: eq(uploads.id, id) });
  if (!up || (up.userId !== user.id && user.role !== "ADMIN")) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(up.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="upload-${up.id}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
