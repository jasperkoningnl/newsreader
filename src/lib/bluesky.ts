const PDS_BASE = process.env.BSKY_SERVICE ?? "https://bsky.social";

type Session = {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
};

export type ExternalEmbed = {
  uri: string;
  title?: string;
  description?: string;
  thumb?: string;
};

export type FeedItem = {
  postUri: string;
  postCid: string;
  authorDid: string;
  authorHandle: string;
  indexedAt: string;
  external: ExternalEmbed | null;
  reason: { type: "repost"; byDid: string; byHandle: string } | null;
};

async function xrpc<T>(
  method: "GET" | "POST",
  nsid: string,
  opts: { token?: string; query?: Record<string, string | number>; body?: unknown },
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, PDS_BASE);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.body) headers["content-type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`bluesky ${nsid} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function login(identifier: string, appPassword: string): Promise<Session> {
  return xrpc<Session>("POST", "com.atproto.server.createSession", {
    body: { identifier, password: appPassword },
  });
}

function extractExternal(embed: unknown): ExternalEmbed | null {
  if (!embed || typeof embed !== "object") return null;
  const e = embed as Record<string, unknown>;
  const direct = e.external;
  if (direct && typeof direct === "object" && typeof (direct as { uri?: unknown }).uri === "string") {
    return direct as ExternalEmbed;
  }
  const media = e.media;
  if (media && typeof media === "object") {
    return extractExternal(media);
  }
  return null;
}

type RawFeedItem = {
  post: {
    uri: string;
    cid: string;
    author: { did: string; handle: string };
    embed?: unknown;
    indexedAt: string;
  };
  reason?: { $type?: string; by?: { did: string; handle: string } };
};

function mapItem(item: RawFeedItem): FeedItem {
  const reason =
    item.reason?.$type === "app.bsky.feed.defs#reasonRepost" && item.reason.by
      ? { type: "repost" as const, byDid: item.reason.by.did, byHandle: item.reason.by.handle }
      : null;
  return {
    postUri: item.post.uri,
    postCid: item.post.cid,
    authorDid: item.post.author.did,
    authorHandle: item.post.author.handle,
    indexedAt: item.post.indexedAt,
    external: extractExternal(item.post.embed),
    reason,
  };
}

export async function getActorLikes(
  session: Session,
  limit: number,
): Promise<FeedItem[]> {
  const res = await xrpc<{ feed: RawFeedItem[] }>("GET", "app.bsky.feed.getActorLikes", {
    token: session.accessJwt,
    query: { actor: session.did, limit },
  });
  return res.feed.map(mapItem);
}

export async function getTimeline(session: Session, limit: number): Promise<FeedItem[]> {
  const res = await xrpc<{ feed: RawFeedItem[] }>("GET", "app.bsky.feed.getTimeline", {
    token: session.accessJwt,
    query: { limit },
  });
  return res.feed.map(mapItem);
}
