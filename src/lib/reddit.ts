const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

type Token = { access_token: string; expires_at: number };

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

async function fetchToken(): Promise<Token> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  if (!id || !secret || !username || !password) {
    throw new Error("REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD must be set");
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent(),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`reddit token ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
}

let cached: Token | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.expires_at > Date.now()) return cached.access_token;
  cached = await fetchToken();
  return cached.access_token;
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

async function listing(path: string, limit: number): Promise<RedditPost[]> {
  const token = await getToken();
  const url = new URL(path, API_BASE);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("raw_json", "1");

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": userAgent(),
    },
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
  const username = process.env.REDDIT_USERNAME!;
  return listing(`/user/${username}/saved`, limit);
}

export async function getUpvoted(limit: number): Promise<RedditPost[]> {
  const username = process.env.REDDIT_USERNAME!;
  return listing(`/user/${username}/upvoted`, limit);
}

export async function getBest(limit: number): Promise<RedditPost[]> {
  return listing("/best", limit);
}
