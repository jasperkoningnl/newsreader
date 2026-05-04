import { db } from "@/db";
import { article_likes, articles, sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const articleId = parseInt(id, 10);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const liked = body?.liked === false || body?.liked === 0 ? 0 : 1;

    const [article] = await db
      .select({ source_id: articles.source_id, category: articles.category })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const topic = String(article.category ?? "other").toLowerCase().trim() || "other";
    await db.delete(article_likes).where(eq(article_likes.article_id, articleId));

    const [created] = await db
      .insert(article_likes)
      .values({
        article_id: articleId,
        source_id: article.source_id,
        topic,
        liked,
      })
      .returning();

    const sourceName = article.source_id
      ? (await db.select({ name: sources.name }).from(sources).where(eq(sources.id, article.source_id)).limit(1))[0]?.name ?? null
      : null;

    return NextResponse.json({ ...created, source: sourceName, topic }, { status: 201 });
  } catch (error) {
    console.error("POST /api/articles/[id]/like:", error);
    return NextResponse.json({ error: "Failed to save like" }, { status: 500 });
  }
}
