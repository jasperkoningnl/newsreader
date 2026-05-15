import { db } from "@/db";
import { articles, link_signals, sources } from "@/db/schema";
import { eq, gte, sql } from "drizzle-orm";
import { discoverFeedUrl } from "./feed-discovery";
import { cleanHtmlText } from "./html-text";

const NON_ARTICLE_HOSTS = new Set([
  "imgur.com",
  "i.imgur.com",
  "m.imgur.com",
  "gfycat.com",
  "giphy.com",
  "tenor.com",
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "tiktok.com",
  "vm.tiktok.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "threads.net",
  "facebook.com",
  "fb.watch",
]);

const MIN_PROMOTE_SCORE = 0.3;
const SIGNAL_LOOKBACK_DAYS = 7;
const MAX_PROMOTE_PER_RUN = 40;

type Aggregate = {
  url: string;
  url_normalized: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  score: number;
  count: number;
  platforms: Set<string>;
  handles: Set<string>;
};

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function aggregateRecent(): Promise<Aggregate[]> {
  const since = new Date(Date.now() - SIGNAL_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const rows = await db.select().from(link_signals).where(gte(link_signals.seen_at, since));

  const map = new Map<string, Aggregate>();
  for (const row of rows) {
    const existing = map.get(row.url_normalized);
    if (existing) {
      existing.score += row.weight;
      existing.count += 1;
      existing.platforms.add(row.source_platform);
      if (row.source_handle) existing.handles.add(row.source_handle);
      existing.title ||= row.title;
      existing.description ||= row.description;
      existing.image_url ||= row.image_url;
    } else {
      map.set(row.url_normalized, {
        url: row.url,
        url_normalized: row.url_normalized,
        title: row.title,
        description: row.description,
        image_url: row.image_url,
        score: row.weight,
        count: 1,
        platforms: new Set([row.source_platform]),
        handles: new Set(row.source_handle ? [row.source_handle] : []),
      });
    }
  }

  return [...map.values()].sort((a, b) => b.score - a.score);
}

type SourceMatch = { id: number; created: boolean };

async function findOrCreateSource(hostname: string): Promise<SourceMatch> {
  const allSources = await db.select({ id: sources.id, url: sources.url }).from(sources);
  for (const s of allSources) {
    const existingHost = hostnameOf(s.url);
    if (existingHost === hostname) return { id: s.id, created: false };
  }

  const websiteUrl = `https://${hostname}`;
  let feedUrl: string | null = null;
  try {
    feedUrl = await discoverFeedUrl(websiteUrl);
  } catch {
    feedUrl = null;
  }

  try {
    const [created] = await db
      .insert(sources)
      .values({ name: hostname, url: websiteUrl, feed_url: feedUrl, active: 1 })
      .returning({ id: sources.id });
    return { id: created.id, created: true };
  } catch {
    const retry = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.url, websiteUrl))
      .limit(1);
    if (retry.length) return { id: retry[0].id, created: false };
    throw new Error(`failed to create source for ${hostname}`);
  }
}

export type PromoteResult = {
  considered: number;
  promoted: number;
  updated: number;
  new_sources: number;
  skipped_low_score: number;
  skipped_non_article: number;
  skipped_no_image: number;
};

export async function promoteSignalsToArticles(): Promise<PromoteResult> {
  const aggregates = await aggregateRecent();
  const result: PromoteResult = {
    considered: aggregates.length,
    promoted: 0,
    updated: 0,
    new_sources: 0,
    skipped_low_score: 0,
    skipped_non_article: 0,
    skipped_no_image: 0,
  };

  let processed = 0;
  for (const agg of aggregates) {
    if (processed >= MAX_PROMOTE_PER_RUN) break;

    if (agg.score < MIN_PROMOTE_SCORE) {
      result.skipped_low_score += 1;
      continue;
    }

    const host = hostnameOf(agg.url);
    if (!host || NON_ARTICLE_HOSTS.has(host)) {
      result.skipped_non_article += 1;
      continue;
    }

    if (!agg.image_url) {
      result.skipped_no_image += 1;
      continue;
    }

    processed += 1;

    const existing = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, agg.url))
      .limit(1);

    if (existing.length) {
      await db
        .update(articles)
        .set({ signal_score: agg.score })
        .where(eq(articles.id, existing[0].id));
      result.updated += 1;
      continue;
    }

    const src = await findOrCreateSource(host);
    if (src.created) result.new_sources += 1;

    try {
      await db
        .insert(articles)
        .values({
          source_id: src.id,
          title: agg.title ? cleanHtmlText(agg.title) : agg.url,
          url: agg.url,
          description: agg.description ? cleanHtmlText(agg.description).slice(0, 500) : null,
          image_url: agg.image_url,
          published_at: null,
          fetched_at: sql`(datetime('now'))`,
          category: null,
          read: 0,
          signal_score: agg.score,
        })
        .onConflictDoNothing({ target: articles.url });
      result.promoted += 1;
    } catch (error) {
      console.error("[promote-signals] insert failed", agg.url, error);
    }
  }

  return result;
}
