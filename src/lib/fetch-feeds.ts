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

    return { source: source.name, fetched, skipped, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { source: source.name, fetched: 0, skipped: 0, error: message };
  }
}

// Haalt een batch bronnen volledig parallel op (Promise.allSettled).
// offset + limit zijn voor client-side batching: de client roept dit
// meerdere keren aan zodat elke Vercel-call binnen 10s blijft.
export async function fetchFeedsBatch(offset = 0, limit = 20): Promise<{
  results: FetchResult[];
  total: number;
  offset: number;
  limit: number;
}> {
  const activeSources = await db.select().from(sources).where(eq(sources.active, 1));
  const batch = activeSources.slice(offset, offset + limit);

  console.log(`[fetch-feeds] batch offset=${offset} limit=${limit}: ${batch.length} bronnen parallel`);

  const settled = await Promise.allSettled(batch.map(fetchOneFeed));
  const results = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { source: batch[i].name, fetched: 0, skipped: 0, error: String((r as PromiseRejectedResult).reason) }
  );

  const ok = results.filter((r) => r.error === null);
  const failed = results.filter((r) => r.error !== null);
  console.log(
    `[fetch-feeds] batch klaar: ${ok.length} ok, ${failed.length} fout` +
    (failed.length ? ` — ${failed.map((f) => `${f.source}: ${f.error}`).join("; ")}` : "")
  );

  return { results, total: activeSources.length, offset, limit };
}

// Wrapper voor de cron (haalt alles op in één aanroep).
export async function fetchAllFeeds(): Promise<FetchResult[]> {
  const { results } = await fetchFeedsBatch(0, 9999);
  return results;
}
