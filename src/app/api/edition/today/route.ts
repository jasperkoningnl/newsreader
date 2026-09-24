import { db } from "@/db";
import { article_likes, articles, editions, saved_articles, sources } from "@/db/schema";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalToken } from "@/lib/api-auth";
import { cleanHtmlText } from "@/lib/html-text";

export const maxDuration = 300;
import { generateTodaysEdition, type SundayPayload, type SundayRole, type SundayTip } from "@/lib/generate-sunday";
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
  disliked: boolean;
  saved: boolean;
  is_paywall: boolean;
  signal_score: number;
  role: SundayRole | null;
  minutes: number | null;
};

export type SavedThisWeek = { id: number; title: string; source: string };

export type TodayEdition = {
  id: number;
  created_at: string | null;
  kind: "daily" | "sunday";
  items: EditionItem[];
  tips: SundayTip[];
  saved: SavedThisWeek[];
};

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") === "true";
    if (force) {
      const unauthorized = requireInternalToken(req);
      if (unauthorized) return unauthorized;
    }
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

  const { edition_id } = await generateTodaysEdition();
  const [newEdition] = await db
    .select()
    .from(editions)
    .where(eq(editions.id, edition_id));
  return buildEdition(newEdition);
}

async function buildEdition(edition: typeof editions.$inferSelect): Promise<TodayEdition> {
  const sunday: SundayPayload | null = edition.kind === "sunday" ? JSON.parse(edition.items_json) : null;
  const parsed: { id: number; motivatie: string; role?: SundayRole; minutes?: number | null }[] =
    sunday ? sunday.items : JSON.parse(edition.items_json);
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
      is_paywall: sql<number>`coalesce(${articles.is_paywall}, ${sources.is_paywall}, 0)`,
      signal_score: articles.signal_score,
      liked: sql<number>`max(case when ${article_likes.liked} = 1 then 1 else 0 end)`,
      disliked: sql<number>`max(case when ${article_likes.liked} = 0 then 1 else 0 end)`,
      saved: sql<number>`max(case when ${saved_articles.id} is not null then 1 else 0 end)`,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .leftJoin(article_likes, eq(article_likes.article_id, articles.id))
    .leftJoin(saved_articles, eq(saved_articles.article_id, articles.id))
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
      articles.is_paywall,
      sources.is_paywall,
      articles.signal_score,
    );

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const items: EditionItem[] = parsed
    .map((p) => {
      const a = byId[p.id];
      return a
        ? {
            ...a,
            title: cleanHtmlText(a.title),
            description: a.description ? cleanHtmlText(a.description) : null,
            motivatie: cleanHtmlText(p.motivatie),
            liked: Boolean(a.liked),
            disliked: Boolean(a.disliked),
            saved: Boolean(a.saved),
            is_paywall: a.is_paywall === 1,
            signal_score: a.signal_score ?? 0,
            role: p.role ?? null,
            minutes: p.minutes ?? null,
          }
        : null;
    })
    .filter((x): x is EditionItem => x !== null);

  const savedIds = sunday?.saved_ids ?? [];
  const savedRows = savedIds.length
    ? await db
        .select({ id: articles.id, title: articles.title, source: sources.name })
        .from(articles)
        .innerJoin(sources, eq(articles.source_id, sources.id))
        .where(inArray(articles.id, savedIds))
    : [];
  const saved = savedIds
    .map((id) => savedRows.find((r) => r.id === id))
    .filter((r): r is SavedThisWeek => r !== undefined)
    .map((r) => ({ ...r, title: cleanHtmlText(r.title) }));

  return {
    id: edition.id,
    created_at: edition.created_at,
    kind: sunday ? "sunday" : "daily",
    items,
    tips: sunday?.tips ?? [],
    saved,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getEditionByDate(dateStr: string): Promise<TodayEdition | null> {
  if (!DATE_RE.test(dateStr)) return null;
  const [edition] = await db
    .select()
    .from(editions)
    .where(sql`date(${editions.created_at}) = ${dateStr}`)
    .orderBy(desc(editions.created_at))
    .limit(1);
  if (!edition) return null;
  return buildEdition(edition);
}

export async function listEditionDates(limit = 30): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: sql<string>`date(${editions.created_at})` })
    .from(editions)
    .orderBy(desc(sql`date(${editions.created_at})`))
    .limit(limit);
  return rows.map((r) => r.date).filter(Boolean);
}
