import { db } from "@/db";
import { articles } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
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
    await db
      .update(articles)
      .set({ opened_at: sql`(datetime('now'))` })
      .where(and(eq(articles.id, articleId), isNull(articles.opened_at)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/articles/[id]/open:", error);
    return NextResponse.json({ error: "Failed to record open" }, { status: 500 });
  }
}
