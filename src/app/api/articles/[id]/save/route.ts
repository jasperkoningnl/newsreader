import { db } from "@/db";
import { articles, saved_articles } from "@/db/schema";
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

    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const [created] = await db
      .insert(saved_articles)
      .values({ article_id: articleId })
      .onConflictDoNothing({ target: saved_articles.article_id })
      .returning();

    return NextResponse.json(created ?? { article_id: articleId, already_saved: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/articles/[id]/save:", error);
    return NextResponse.json({ error: "Failed to save article" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const articleId = parseInt(id, 10);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
    }
    await db.delete(saved_articles).where(eq(saved_articles.article_id, articleId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/articles/[id]/save:", error);
    return NextResponse.json({ error: "Failed to remove saved article" }, { status: 500 });
  }
}
