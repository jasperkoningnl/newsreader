import { db } from "@/db";
import { articles } from "@/db/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOriginOrInternalToken } from "@/lib/api-auth";
import { detectPaywall } from "@/lib/paywall-detect";

export const maxDuration = 300;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CONCURRENCY = 5;

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOriginOrInternalToken(req);
  if (unauthorized) return unauthorized;

  try {
    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? DEFAULT_LIMIT : limitParam), MAX_LIMIT);

    const targets = await db
      .select({ id: articles.id, url: articles.url })
      .from(articles)
      .where(isNull(articles.is_paywall))
      .orderBy(articles.id)
      .limit(limit);

    if (!targets.length) {
      return NextResponse.json({ checked: 0, hits: 0, free: 0, unknown: 0, remaining: 0 });
    }

    let cursor = 0;
    let hits = 0;
    let free = 0;
    let unknown = 0;
    const now = sql`(datetime('now'))`;

    async function worker() {
      while (cursor < targets.length) {
        const i = cursor++;
        const t = targets[i];
        const verdict = await detectPaywall(t.url);
        if (verdict.is_paywall === true) hits++;
        else if (verdict.is_paywall === false) free++;
        else unknown++;
        try {
          await db
            .update(articles)
            .set({
              is_paywall: verdict.is_paywall === null ? null : verdict.is_paywall ? 1 : 0,
              paywall_checked_at: now,
            })
            .where(eq(articles.id, t.id));
        } catch (err) {
          console.warn("[paywall.persist] failed", t.id, err);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)
    );

    const [{ value: remaining }] = await db
      .select({ value: sql<number>`count(*)` })
      .from(articles)
      .where(isNull(articles.is_paywall));

    return NextResponse.json({
      checked: targets.length,
      hits,
      free,
      unknown,
      remaining,
    });
  } catch (error) {
    console.error("POST /api/paywall-scan:", error);
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
