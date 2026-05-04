import { db } from "@/db";
import { articles } from "@/db/schema";
import { fetchAllFeeds } from "@/lib/fetch-feeds";
import { generateEdition } from "@/lib/generate-edition";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalToken } from "@/lib/api-auth";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalToken(req);
  if (unauthorized) return unauthorized;
  try {
    await db.update(articles).set({ read: 0 });
    const feedResults = await fetchAllFeeds();
    const { edition_id, count } = await generateEdition();

    const ok = feedResults.filter((r) => r.error === null).length;
    const failed = feedResults.filter((r) => r.error !== null).length;
    const newArticles = feedResults.reduce((sum, r) => sum + r.fetched, 0);

    return NextResponse.json({ edition_id, count, feeds: { ok, failed, newArticles } });
  } catch (error) {
    console.error("[/api/refresh]", error);
    const message = error instanceof Error ? error.message : "Mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
