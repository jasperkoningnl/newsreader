import { fetchFeedsBatch } from "@/lib/fetch-feeds";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10);
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  try {
    const { results, total, offset: off, limit: lim } = await fetchFeedsBatch(offset, limit);

    const ok = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);

    return NextResponse.json({
      total,
      offset: off,
      limit: lim,
      fetched_sources: ok.length,
      failed_sources: failed.length,
      new_articles: ok.reduce((s, r) => s + r.fetched, 0),
      failures: failed.map((r) => ({ source: r.source, error: r.error })),
      results,
    });
  } catch (error) {
    console.error("POST /api/fetch-feeds:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
