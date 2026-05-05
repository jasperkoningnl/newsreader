const BASE = "https://www.reddit.com";

export type RedditPost = {
  fullname: string;
  url: string;
  permalink: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  thumbnail: string | null;
  preview_image: string | null;
  is_self: boolean;
  over_18: boolean;
  created_utc: number;
};

type RawListing = {
  data: {
    children: { data: RawPost }[];
    after: string | null;
  };
};

type RawPost = {
  name: string;
  url?: string;
  url_overridden_by_dest?: string;
  permalink: string;
  title: string;
  selftext?: string;
  subreddit: string;
  author: string;
  thumbnail?: string;
  preview?: { images?: { source?: { url?: string } }[] };
  is_self: boolean;
  over_18: boolean;
  created_utc: number;
};

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? "newsreader/1.0";
}

function mapPost(raw: RawPost): RedditPost {
  const previewRaw = raw.preview?.images?.[0]?.source?.url;
  const preview = previewRaw ? previewRaw.replace(/&amp;/g, "&") : null;
  const thumb = raw.thumbnail && raw.thumbnail.startsWith("http") ? raw.thumbnail : null;
  return {
    fullname: raw.name,
    url: raw.url_overridden_by_dest ?? raw.url ?? "",
    permalink: `https://www.reddit.com${raw.permalink}`,
    title: raw.title,
    selftext: raw.selftext ?? "",
    subreddit: raw.subreddit,
    author: raw.author,
    thumbnail: thumb,
    preview_image: preview,
    is_self: raw.is_self,
    over_18: raw.over_18,
    created_utc: raw.created_utc,
  };
}

async function fetchPersonalListing(path: string, limit: number): Promise<RedditPost[]> {
  const username = process.env.REDDIT_USERNAME;
  const token = process.env.REDDIT_FEED_TOKEN;
  if (!username || !token) {
    throw new Error("REDDIT_USERNAME and REDDIT_FEED_TOKEN must be set");
  }

  const url = new URL(`/user/${username}/${path}.json`, BASE);
  url.searchParams.set("feed", token);
  url.searchParams.set("user", username);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("raw_json", "1");

  const res = await fetch(url, {
    headers: { "user-agent": userAgent() },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`reddit ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as RawListing;
  return json.data.children.map((c) => mapPost(c.data));
}

export async function getSaved(limit: number): Promise<RedditPost[]> {
  return fetchPersonalListing("saved", limit);
}

export async function getUpvoted(limit: number): Promise<RedditPost[]> {
  return fetchPersonalListing("upvoted", limit);
}
