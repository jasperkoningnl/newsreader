import { assertSafePublicUrl } from "./net-safety";

const KNOWN_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/feeds/posts/default",
];

const MAX_REDIRECTS = 5;

async function safeFetch(url: string, timeoutMs: number): Promise<Response | null> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafePublicUrl(current);
    const res = await fetch(current, {
      headers: { "User-Agent": "NewsreaderBot/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

export async function discoverFeedUrl(websiteUrl: string): Promise<string | null> {
  const base = new URL(websiteUrl);
  const origin = base.origin;

  try {
    const res = await safeFetch(websiteUrl, 8000);
    const html = res ? await res.text() : "";

    const linkMatch = html.match(
      /<link[^>]+type=["'](application\/(rss|atom)\+xml)["'][^>]*href=["']([^"']+)["']/i
    ) ?? html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+type=["'](application\/(rss|atom)\+xml)["']/i
    );

    if (linkMatch) {
      const href = linkMatch[linkMatch.length === 4 ? 3 : 1];
      const candidate = href.startsWith("http") ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
      try {
        await assertSafePublicUrl(candidate);
        return candidate;
      } catch {
        // fall through
      }
    }
  } catch {
    // HTML fetch failed, fall through to path guessing
  }

  for (const path of KNOWN_FEED_PATHS) {
    try {
      const url = `${origin}${path}`;
      const res = await safeFetch(url, 5000);
      if (res?.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) {
          return url;
        }
      }
    } catch {
      // try next path
    }
  }

  return null;
}
