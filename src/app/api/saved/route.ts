import { db } from "@/db";
import { articles, saved_articles, sources } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { cleanHtmlText } from "@/lib/html-text";
import { pickUrl, saveUrl, SaveUrlError } from "@/lib/save-url";
import { labelInBackground } from "@/lib/taste";

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

    const items: SavedItem[] = rows.map((row) => ({
      ...row,
      title: cleanHtmlText(row.title),
      description: row.description ? cleanHtmlText(row.description) : null,
    }));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("GET /api/saved:", error);
    return NextResponse.json({ error: "Failed to fetch saved articles" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json().catch(() => ({}));
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : null);
    const url = pickUrl(str(body?.url), str(body?.text));
    if (!url) return NextResponse.json({ error: "No URL found" }, { status: 400 });

    const saved = await saveUrl(url, str(body?.title)?.slice(0, 300) || null);
    after(() => labelInBackground(saved.article_id));
    return NextResponse.json({ ...saved, title: cleanHtmlText(saved.title) }, { status: 201 });
  } catch (error) {
    if (error instanceof SaveUrlError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("POST /api/saved:", error);
    return NextResponse.json({ error: "Failed to save URL" }, { status: 500 });
  }
}
