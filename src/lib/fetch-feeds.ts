import { db } from "@/db";
import { articles, sources } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Parser from "rss-parser";
import { assertSafePublicUrl } from "./net-safety";

const FAILURE_THRESHOLD = 3;

type RssItem = Parser.Item & {
  mediaContent?: { $?: { url?: string } };
  mediaThumbnail?: { $?: { url?: string } };
  enclosure?: { url?: string; type?: string };
  thumbnail?: string;
  "content:encoded"?: string;
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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  bull: "•", middot: "·", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›",
  euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", plusmn: "±",
  times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", micro: "µ", para: "¶", sect: "§", iquest: "¿",
  iexcl: "¡", szlig: "ß", AElig: "Æ", aelig: "æ", OElig: "Œ", oelig: "œ",
  Aacute: "Á", aacute: "á", Agrave: "À", agrave: "à", Acirc: "Â", acirc: "â",
  Auml: "Ä", auml: "ä", Atilde: "Ã", atilde: "ã", Aring: "Å", aring: "å",
  Ccedil: "Ç", ccedil: "ç", Eacute: "É", eacute: "é", Egrave: "È", egrave: "è",
  Ecirc: "Ê", ecirc: "ê", Euml: "Ë", euml: "ë", Iacute: "Í", iacute: "í",
  Igrave: "Ì", igrave: "ì", Icirc: "Î", icirc: "î", Iuml: "Ï", iuml: "ï",
  Ntilde: "Ñ", ntilde: "ñ", Oacute: "Ó", oacute: "ó", Ograve: "Ò", ograve: "ò",
  Ocirc: "Ô", ocirc: "ô", Ouml: "Ö", ouml: "ö", Otilde: "Õ", otilde: "õ",
  Oslash: "Ø", oslash: "ø", Uacute: "Ú", uacute: "ú", Ugrave: "Ù", ugrave: "ù",
  Ucirc: "Û", ucirc: "û", Uuml: "Ü", uuml: "ü", Yacute: "Ý", yacute: "ý", yuml: "ÿ",
};

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole);
}

function cleanText(str: string): string {
  return decodeHtmlEntities(str).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractImageUrl(item: RssItem): string | null {
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (item.enclosure?.url) {
    const type = item.enclosure.type ?? "";
    if (!type || type.startsWith("image/")) return item.enclosure.url;
  }
  if (item.thumbnail) return item.thumbnail;

  const htmlCandidates = [item["content:encoded"], item.content, item.contentSnippet].filter((v): v is string => !!v);
  for (const html of htmlCandidates) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1]) return imgMatch[1];
  }

  return null;
}

export type FetchResult = {
  source: string;
  fetched: number;
  skipped: number;
  error: string | null;
  auto_disabled?: boolean;
};

async function recordSuccess(sourceId: number) {
  await db
    .update(sources)
    .set({ consecutive_failures: 0, last_failure_at: null, last_failure_reason: null })
    .where(eq(sources.id, sourceId));
}

async function recordFailure(sourceId: number, reason: string): Promise<{ auto_disabled: boolean }> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const truncated = reason.slice(0, 300);
  await db
    .update(sources)
    .set({
      consecutive_failures: sql`coalesce(${sources.consecutive_failures}, 0) + 1`,
      last_failure_at: now,
      last_failure_reason: truncated,
    })
    .where(eq(sources.id, sourceId));

  const [row] = await db
    .select({ failures: sources.consecutive_failures, active: sources.active })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  if ((row?.failures ?? 0) >= FAILURE_THRESHOLD && row?.active !== 0) {
    await db.update(sources).set({ active: 0 }).where(eq(sources.id, sourceId));
    return { auto_disabled: true };
  }
  return { auto_disabled: false };
}

async function fetchOneFeed(source: typeof sources.$inferSelect): Promise<FetchResult> {
  if (!source.feed_url) {
    const { auto_disabled } = await recordFailure(source.id, "geen feed_url");
    return { source: source.name, fetched: 0, skipped: 0, error: "geen feed_url", auto_disabled };
  }

  try {
    await assertSafePublicUrl(source.feed_url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "feed_url not allowed";
    const { auto_disabled } = await recordFailure(source.id, message);
    return { source: source.name, fetched: 0, skipped: 0, error: message, auto_disabled };
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
          title: cleanText(item.title),
          url: item.link,
          description: item.contentSnippet
            ? cleanText(item.contentSnippet).slice(0, 500)
            : null,
          image_url: extractImageUrl(item),
          published_at: item.pubDate ?? item.isoDate ?? null,
          category: source.category,
        })
        .onConflictDoNothing();

      if (result.rowsAffected > 0) fetched++; else skipped++;
    }

    await recordSuccess(source.id);
    return { source: source.name, fetched, skipped, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { auto_disabled } = await recordFailure(source.id, message);
    return { source: source.name, fetched: 0, skipped: 0, error: message, auto_disabled };
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
