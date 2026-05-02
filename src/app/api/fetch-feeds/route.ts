import { db } from "@/db";
import { articles, sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [["media:content", "mediaContent", { keepArray: false }]],
  },
});

function extractImageUrl(item: Parser.Item & { mediaContent?: { $?: { url?: string } } }): string | null {
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  const enclosure = (item as { enclosure?: { url?: string; type?: string } }).enclosure;
  if (enclosure?.type?.startsWith("image/") && enclosure.url) return enclosure.url;
  const imgMatch = item.content?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSources = await db
    .select()
    .from(sources)
    .where(eq(sources.active, 1));

  const results: { source: string; fetched: number; errors: number }[] = [];

  for (const source of activeSources) {
    if (!source.feed_url) continue;

    try {
      const feed = await parser.parseURL(source.feed_url);
      let fetched = 0;

      for (const item of feed.items.slice(0, 20)) {
        if (!item.title || !item.link) continue;

        try {
          await db
            .insert(articles)
            .values({
              source_id: source.id,
              title: item.title,
              url: item.link,
              description: item.contentSnippet ?? item.summary ?? null,
              image_url: extractImageUrl(item as Parameters<typeof extractImageUrl>[0]),
              published_at: item.pubDate ?? item.isoDate ?? null,
              category: source.category,
            })
            .onConflictDoNothing();
          fetched++;
        } catch {
          // duplicate or constraint error — skip
        }
      }

      results.push({ source: source.name, fetched, errors: 0 });
    } catch (err) {
      console.error(`Fetch failed for ${source.name}:`, err);
      results.push({ source: source.name, fetched: 0, errors: 1 });
    }
  }

  return NextResponse.json({ results });
}
