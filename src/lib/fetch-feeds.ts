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
  timeout: 8000,
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
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (item.enclosure?.url) {
    const type = item.enclosure.type ?? "";
    if (!type || type.startsWith("image/")) return item.enclosure.url;
  }
  const imgMatch = item.content?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

export type FetchResult = {
  source: string;
  fetched: number;
  skipped: number;
  error: string | null;
};

async function fetchOneFeed(source: typeof sources.$inferSelect): Promise<FetchResult> {
  if (!source.feed_url) {
    return { source: source.name, fetched: 0, skipped: 0, error: "geen feed_url" };
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
    return { source: source.name, fetched, skipped, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fetch-feeds] ERR ${source.name} (${source.feed_url}): ${message}`);
    return { source: source.name, fetched: 0, skipped: 0, error: message };
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<FetchResult>
): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export async function fetchAllFeeds(): Promise<FetchResult[]> {
  const activeSources = await db.select().from(sources).where(eq(sources.active, 1));
  console.log(`[fetch-feeds] ${activeSources.length} actieve bronnen, ophalen in batches van 10`);
  return runWithConcurrency(activeSources, 10, fetchOneFeed);
}
