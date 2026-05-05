import Parser from "rss-parser";

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

type AtomItem = Parser.Item & {
  id?: string;
  author?: string;
};

function userAgent(): string {
  const ua = process.env.REDDIT_USER_AGENT;
  if (!ua) {
    throw new Error("REDDIT_USER_AGENT must be set (e.g. 'web:newsreader:v1.0 (by /u/<username>)')");
  }
  return ua;
}

function feedUrl(path: string): string {
  const username = process.env.REDDIT_USERNAME;
  const token = process.env.REDDIT_FEED_TOKEN;
  if (!username || !token) {
    throw new Error("REDDIT_USERNAME and REDDIT_FEED_TOKEN must be set");
  }
  const url = new URL(`/user/${username}/${path}.rss`, BASE);
  url.searchParams.set("feed", token);
  url.searchParams.set("user", username);
  return url.toString();
}

const parser = new Parser<Record<string, unknown>, AtomItem>({
  timeout: 15_000,
  customFields: {
    item: ["id"],
  },
});

function extractExternalUrl(content: string | undefined, commentLink: string): {
  url: string;
  is_self: boolean;
} {
  if (!content) return { url: commentLink, is_self: true };
  const match = content.match(/<a href="([^"]+)">\s*\[link\]\s*<\/a>/i);
  if (!match) return { url: commentLink, is_self: true };
  const candidate = match[1];
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    const commentHost = new URL(commentLink).hostname.toLowerCase();
    if (host === commentHost || host.endsWith(".reddit.com")) {
      return { url: commentLink, is_self: true };
    }
    return { url: candidate, is_self: false };
  } catch {
    return { url: commentLink, is_self: true };
  }
}

function extractSubreddit(commentLink: string, item: AtomItem): string {
  const match = commentLink.match(/\/r\/([^/]+)\//);
  if (match) return match[1];
  const cats = item.categories as unknown[] | undefined;
  for (const cat of cats ?? []) {
    if (typeof cat === "string") {
      const m = cat.match(/^r\/(.+)$/);
      if (m) return m[1];
    } else if (cat && typeof cat === "object") {
      const attrs = (cat as { $?: { label?: string; term?: string } }).$;
      const label = attrs?.label ?? attrs?.term;
      if (label) {
        const m = label.match(/^r\/(.+)$/);
        if (m) return m[1];
      }
    }
  }
  return "unknown";
}

function extractThumbnail(content: string | undefined): string | null {
  if (!content) return null;
  const match = content.match(/<img src="([^"]+)"/i);
  return match ? match[1] : null;
}

function fullnameFromId(id: string | undefined, link: string): string {
  if (id && id.startsWith("t3_")) return id;
  if (id) return id;
  const m = link.match(/\/comments\/([a-z0-9]+)\//);
  return m ? `t3_${m[1]}` : link;
}

async function fetchListing(path: string): Promise<RedditPost[]> {
  const url = feedUrl(path);
  const res = await fetch(url, {
    headers: {
      "user-agent": userAgent(),
      accept: "application/atom+xml, application/rss+xml, application/xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`reddit ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  const xml = await res.text();
  const feed = await parser.parseString(xml);

  return feed.items.map((item) => {
    const commentLink = item.link ?? "";
    const { url: extUrl, is_self } = extractExternalUrl(item.content, commentLink);
    const subreddit = extractSubreddit(commentLink, item);
    const author = (item.author ?? "").replace(/^\/u\//, "");
    const created = item.isoDate ? Date.parse(item.isoDate) / 1000 : 0;

    return {
      fullname: fullnameFromId(item.id, commentLink),
      url: extUrl,
      permalink: commentLink,
      title: item.title ?? "",
      selftext: "",
      subreddit,
      author,
      thumbnail: null,
      preview_image: extractThumbnail(item.content),
      is_self,
      over_18: false,
      created_utc: created,
    };
  });
}

export async function getSaved(_limit: number): Promise<RedditPost[]> {
  return fetchListing("saved");
}

export async function getUpvoted(_limit: number): Promise<RedditPost[]> {
  return fetchListing("upvoted");
}
