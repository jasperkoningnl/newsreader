import { db } from "@/db";
import { link_signals, type NewLinkSignal } from "@/db/schema";
import { getActorLikes, getTimeline, login, type FeedItem } from "./bluesky";
import { cleanHtmlText } from "./html-text";
import { normalizeUrl } from "./url-normalize";

const SKIP_HOSTNAMES = new Set([
  "bsky.app",
  "bsky.social",
  "go.bsky.app",
  "twitter.com",
  "x.com",
  "instagram.com",
]);

const LIKE_WEIGHT = 1.0;
const REPOST_WEIGHT = 0.5;
const MENTION_WEIGHT = 0.3;

type SignalDraft = NewLinkSignal & { external_id: string };

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildSignal(
  item: FeedItem,
  signal_type: "like" | "repost" | "mention",
  weight: number,
  source_handle: string,
  externalIdSuffix: string,
): SignalDraft | null {
  if (!item.external) return null;
  const host = safeHost(item.external.uri);
  if (!host || SKIP_HOSTNAMES.has(host)) return null;

  let normalized: string;
  try {
    normalized = normalizeUrl(item.external.uri);
  } catch {
    return null;
  }

  return {
    url: item.external.uri,
    url_normalized: normalized,
    title: item.external.title ? cleanHtmlText(item.external.title) : null,
    description: item.external.description ? cleanHtmlText(item.external.description) : null,
    image_url: item.external.thumb ?? null,
    source_platform: "bluesky",
    source_handle,
    signal_type,
    weight,
    external_id: `${signal_type}:${item.postUri}:${externalIdSuffix}`,
  };
}

export type IngestResult = {
  likes_seen: number;
  timeline_seen: number;
  inserted: number;
  skipped: number;
};

export async function ingestBluesky(opts?: {
  likesLimit?: number;
  timelineLimit?: number;
}): Promise<IngestResult> {
  const handle = process.env.BSKY_HANDLE;
  const appPassword = process.env.BSKY_APP_PASSWORD;
  if (!handle || !appPassword) {
    throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD must be set");
  }

  const session = await login(handle, appPassword);
  const likesLimit = opts?.likesLimit ?? 50;
  const timelineLimit = opts?.timelineLimit ?? 100;

  const [likes, timeline] = await Promise.all([
    getActorLikes(session, likesLimit),
    getTimeline(session, timelineLimit),
  ]);

  const drafts: SignalDraft[] = [];

  for (const item of likes) {
    const signal = buildSignal(item, "like", LIKE_WEIGHT, session.handle, session.did);
    if (signal) drafts.push(signal);
  }

  for (const item of timeline) {
    if (item.reason?.type === "repost") {
      const signal = buildSignal(
        item,
        "repost",
        REPOST_WEIGHT,
        item.reason.byHandle,
        item.reason.byDid,
      );
      if (signal) drafts.push(signal);
    } else {
      const signal = buildSignal(item, "mention", MENTION_WEIGHT, item.authorHandle, item.authorDid);
      if (signal) drafts.push(signal);
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const draft of drafts) {
    try {
      const result = await db
        .insert(link_signals)
        .values(draft)
        .onConflictDoNothing({ target: [link_signals.source_platform, link_signals.external_id] })
        .returning({ id: link_signals.id });
      if (result.length > 0) inserted += 1;
      else skipped += 1;
    } catch (error) {
      console.error("[ingest-bluesky] insert failed", error);
      skipped += 1;
    }
  }

  return {
    likes_seen: likes.length,
    timeline_seen: timeline.length,
    inserted,
    skipped,
  };
}
