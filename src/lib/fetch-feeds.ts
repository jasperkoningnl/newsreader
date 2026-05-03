import { db } from "@/db";
import { articles, sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import Parser from "rss-parser";

type RssItem = Parser.Item & {
  mediaContent?: { $?: { url?: string } };
  mediaThumbnail?: { $?: { url?: string } };
  enclosure?: { url?: string; type?: string };
};

const parser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
    ],
  },
  timeout: 10000,
});

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractImageUrl(item: RssItem): string | null {
  // media:content
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  // media:thumbnail
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  // enclosure (audio/video feeds have type; image enclosures don't always set type)
  if (item.enclosure?.url) {
    const type = item.enclosure.type ?? "";
    if (!type || type.startsWith("image/")) return item.enclosure.url;
  }
  // <img> in content:encoded
  const imgMatch = item.content?.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];
  return null;
}

export type FetchResult = {
  source: string;
  fetched: number;
  skipped: number;
  error: string | null;
};

export async function fetchAllFeeds(): Promise<FetchResult[]> {
  const activeSources = await db.select().from(sources).where(eq(sources.active, 1));
  const results: FetchResult[] = [];

  for (const source of activeSources) {
    if (!source.feed_url) {
      console.log(`[fetch-feeds] SKIP ${source.name}: geen feed_url`);
      results.push({ source: source.name, fetched: 0, skipped: 0, error: "geen feed_url" });
      continue;
    }

    try {
      const feed = await parser.parseURL(source.feed_url);
      let fetched = 0;
      let skipped = 0;

      for (const item of feed.items.slice(0, 20)) {
        if (!item.title || !item.link) { skipped++; continue; }

        const result = await db
          .insert(articles)
          .values({
            source_id: source.id,
            title: decodeHtmlEntities(item.title),
            url: item.link,
            description: item.contentSnippet
              ? decodeHtmlEntities(item.contentSnippet.slice(0, 500))
              : null,
            image_url: extractImageUrl(item),
            published_at: item.pubDate ?? item.isoDate ?? null,
            category: source.category,
          })
          .onConflictDoNothing();

        if (result.rowsAffected > 0) fetched++; else skipped++;
      }

      console.log(`[fetch-feeds] OK  ${source.name}: ${fetched} nieuw, ${skipped} al bekend`);
      results.push({ source: source.name, fetched, skipped, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[fetch-feeds] ERR ${source.name} (${source.feed_url}): ${message}`);
      results.push({ source: source.name, fetched: 0, skipped: 0, error: message });
    }
  }

  return results;
}
