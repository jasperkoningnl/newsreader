import { db } from "@/db";
import { article_likes, articles, editions, sources } from "@/db/schema";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
import { generateEdition } from "@/lib/generate-edition";
import { fetchAllFeeds } from "@/lib/fetch-feeds";

export type EditionItem = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  image_url: string | null;
  published_at: string | null;
  category: string | null;
  source: string;
  motivatie: string;
  liked: boolean;
};

export type TodayEdition = {
  id: number;
  created_at: string | null;
  items: EditionItem[];
};

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") === "true";
    const edition = await getOrGenerateToday(force);
    return NextResponse.json(edition);
  } catch (error) {
    console.error("GET /api/edition/today:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function getOrGenerateToday(force = false): Promise<TodayEdition> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (!force) {
    const [latest] = await db
      .select()
      .from(editions)
      .orderBy(desc(editions.created_at))
      .limit(1);

    if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
      return buildEdition(latest);
    }
  }

  // Bij force: reset read-status zodat testen de pool niet uitput
  if (force) {
    await db.update(articles).set({ read: 0 });
  }

  // Haal verse feeds op bij force of als er te weinig kandidaten zijn
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const [{ value: candidateCount }] = await db
    .select({ value: count() })
    .from(articles)
    .where(and(eq(articles.read, 0), gte(articles.fetched_at, threeDaysAgo)));

  if (force || candidateCount < 5) {
    await fetchAllFeeds();
  }

  const { edition_id } = await generateEdition();
  const [newEdition] = await db
    .select()
    .from(editions)
    .where(eq(editions.id, edition_id));
  return buildEdition(newEdition);
}

async function buildEdition(edition: typeof editions.$inferSelect): Promise<TodayEdition> {
  const parsed: { id: number; motivatie: string }[] = JSON.parse(edition.items_json);
  const ids = parsed.map((p) => p.id);

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      description: articles.description,
      image_url: articles.image_url,
      published_at: articles.published_at,
      category: articles.category,
      source: sources.name,
      liked: sql<number>`max(coalesce(${article_likes.liked}, 0))`,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .leftJoin(article_likes, eq(article_likes.article_id, articles.id))
    .where(inArray(articles.id, ids))
    .groupBy(
      articles.id,
      articles.title,
      articles.url,
      articles.description,
      articles.image_url,
      articles.published_at,
      articles.category,
      sources.name,
    );

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const items: EditionItem[] = parsed
    .map((p) => {
      const a = byId[p.id];
      return a ? { ...a, motivatie: p.motivatie, liked: Boolean(a.liked) } : null;
    })
    .filter((x): x is EditionItem => x !== null);

  return { id: edition.id, created_at: edition.created_at, items };
}
