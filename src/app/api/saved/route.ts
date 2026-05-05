import { db } from "@/db";
import { articles, saved_articles, sources } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export type SavedItem = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  image_url: string | null;
  published_at: string | null;
  category: string | null;
  source: string;
  saved_at: string | null;
};

export async function GET() {
  try {
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
        saved_at: saved_articles.saved_at,
      })
      .from(saved_articles)
      .innerJoin(articles, eq(saved_articles.article_id, articles.id))
      .innerJoin(sources, eq(articles.source_id, sources.id))
      .orderBy(desc(saved_articles.saved_at));

    const items: SavedItem[] = rows;
    return NextResponse.json({ items });
  } catch (error) {
    console.error("GET /api/saved:", error);
    return NextResponse.json({ error: "Failed to fetch saved articles" }, { status: 500 });
  }
}
