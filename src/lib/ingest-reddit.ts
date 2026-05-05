import { db } from "@/db";
import { link_signals, type NewLinkSignal } from "@/db/schema";
import { getBest, getSaved, getUpvoted, type RedditPost } from "./reddit";
import { normalizeUrl } from "./url-normalize";

const SKIP_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "redd.it",
  "v.redd.it",
  "i.redd.it",
]);

const SAVED_WEIGHT = 1.0;
const UPVOTED_WEIGHT = 0.7;
const BEST_WEIGHT = 0.4;

type SignalDraft = NewLinkSignal & { external_id: string };

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildSignal(
  post: RedditPost,
  signal_type: "saved" | "upvoted" | "best",
  weight: number,
): SignalDraft | null {
  if (post.is_self || post.over_18 || !post.url) return null;
  const host = safeHost(post.url);
  if (!host || SKIP_HOSTS.has(host)) return null;

  let normalized: string;
  try {
    normalized = normalizeUrl(post.url);
  } catch {
    return null;
  }

  return {
    url: post.url,
    url_normalized: normalized,
    title: post.title || null,
    description: post.selftext ? post.selftext.slice(0, 500) : null,
    image_url: post.preview_image ?? post.thumbnail,
    source_platform: "reddit",
    source_handle: `r/${post.subreddit}`,
    signal_type,
    weight,
    external_id: `${signal_type}:${post.fullname}`,
  };
}

export type IngestResult = {
  saved_seen: number;
  upvoted_seen: number;
  best_seen: number;
  inserted: number;
  skipped: number;
};

export async function ingestReddit(opts?: {
  savedLimit?: number;
  upvotedLimit?: number;
  bestLimit?: number;
}): Promise<IngestResult> {
  const savedLimit = opts?.savedLimit ?? 50;
  const upvotedLimit = opts?.upvotedLimit ?? 50;
  const bestLimit = opts?.bestLimit ?? 100;

  const [saved, upvoted, best] = await Promise.all([
    getSaved(savedLimit),
    getUpvoted(upvotedLimit),
    getBest(bestLimit),
  ]);

  const drafts: SignalDraft[] = [];

  for (const post of saved) {
    const signal = buildSignal(post, "saved", SAVED_WEIGHT);
    if (signal) drafts.push(signal);
  }
  for (const post of upvoted) {
    const signal = buildSignal(post, "upvoted", UPVOTED_WEIGHT);
    if (signal) drafts.push(signal);
  }
  for (const post of best) {
    const signal = buildSignal(post, "best", BEST_WEIGHT);
    if (signal) drafts.push(signal);
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
      console.error("[ingest-reddit] insert failed", error);
      skipped += 1;
    }
  }

  return {
    saved_seen: saved.length,
    upvoted_seen: upvoted.length,
    best_seen: best.length,
    inserted,
    skipped,
  };
}
