import { fetchAllFeeds } from "@/lib/fetch-feeds";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  // Vercel stuurt automatisch: Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await fetchAllFeeds();
    const ok = results.filter((r) => r.error === null).length;
    const failed = results.filter((r) => r.error !== null).length;
    const newArticles = results.reduce((sum, r) => sum + r.fetched, 0);
    console.log(`[cron/fetch-feeds] ${ok} ok, ${failed} errors, ${newArticles} new articles`);
    return NextResponse.json({ ok, failed, newArticles });
  } catch (error) {
    console.error("[cron/fetch-feeds]", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
