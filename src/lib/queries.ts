import "server-only";
import { and, desc, eq, isNotNull, sql, count } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import { projects, users, likes } from "./schema";

export const CATEGORIES = ["Portfolio", "Product", "Editorial", "Tugas Kuliah", "Komunitas", "Game", "Lainnya"] as const;

export type ProjectCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  likeCount: number;
  login: string;
  avatarUrl: string | null;
  liked: boolean;
};

const cardFields = {
  id: projects.id,
  slug: projects.slug,
  title: projects.title,
  description: projects.description,
  category: projects.category,
  likeCount: projects.likeCount,
  login: users.login,
  avatarUrl: users.avatarUrl,
};

async function withLiked<T extends { id: string }>(rows: T[], viewerId?: string) {
  if (!viewerId || rows.length === 0) return rows.map((r) => ({ ...r, liked: false }));
  const mine = await db.select({ projectId: likes.projectId }).from(likes).where(eq(likes.userId, viewerId));
  const set = new Set(mine.map((m) => m.projectId));
  return rows.map((r) => ({ ...r, liked: set.has(r.id) }));
}

export async function latestLive(limit = 12, viewerId?: string, category?: string): Promise<ProjectCard[]> {
  const where = category
    ? and(eq(projects.status, "LIVE"), eq(projects.category, category))
    : eq(projects.status, "LIVE");
  const rows = await db
    .select(cardFields)
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(where)
    .orderBy(desc(projects.liveAt))
    .limit(limit);
  return withLiked(rows, viewerId);
}

export async function leaderboard(limit = 50, viewerId?: string): Promise<ProjectCard[]> {
  const rows = await db
    .select(cardFields)
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.status, "LIVE"))
    .orderBy(desc(projects.likeCount), projects.liveAt)
    .limit(limit);
  return withLiked(rows, viewerId);
}

export async function slotStats() {
  const [{ used }] = await db.select({ used: count() }).from(users).where(and(isNotNull(users.activatedAt), eq(users.role, "USER")));
  const [{ live }] = await db.select({ live: count() }).from(projects).where(eq(projects.status, "LIVE"));
  const total = env.betaSlots;
  return { total, used: Number(used), available: Math.max(0, total - Number(used)), live: Number(live) };
}

export async function toggleLike(userId: string, projectId: string): Promise<{ liked: boolean; likeCount: number }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(likes)
      .where(and(eq(likes.userId, userId), eq(likes.projectId, projectId)))
      .returning();
    const liked = deleted.length === 0;
    if (liked) await tx.insert(likes).values({ userId, projectId });
    const [p] = await tx
      .update(projects)
      .set({ likeCount: sql`${projects.likeCount} + ${liked ? 1 : -1}` })
      .where(eq(projects.id, projectId))
      .returning({ likeCount: projects.likeCount });
    return { liked, likeCount: p?.likeCount ?? 0 };
  });
}
