import { db } from "@/db";
import { articles, editions, sources } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generateEdition } from "@/lib/generate-edition";

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
};

export type TodayEdition = {
  id: number;
  created_at: string | null;
  items: EditionItem[];
};

export async function GET() {
  try {
    const edition = await getOrGenerateToday();
    return NextResponse.json(edition);
  } catch (error) {
    console.error("GET /api/edition/today:", error);
    const message = error instanceof Error ? error.message : "Ophalen mislukt";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function getOrGenerateToday(): Promise<TodayEdition> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [latest] = await db
    .select()
    .from(editions)
    .orderBy(desc(editions.created_at))
    .limit(1);

  if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
    return buildEdition(latest);
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
    })
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .where(inArray(articles.id, ids));

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const items: EditionItem[] = parsed
    .map((p) => {
      const a = byId[p.id];
      return a ? { ...a, motivatie: p.motivatie } : null;
    })
    .filter((x): x is EditionItem => x !== null);

  return { id: edition.id, created_at: edition.created_at, items };
}
