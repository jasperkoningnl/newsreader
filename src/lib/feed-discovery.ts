const KNOWN_FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/feeds/posts/default",
];

export async function discoverFeedUrl(websiteUrl: string): Promise<string | null> {
  const base = new URL(websiteUrl);
  const origin = base.origin;

  try {
    const html = await fetch(websiteUrl, {
      headers: { "User-Agent": "NewsreaderBot/1.0" },
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.text());

    const linkMatch = html.match(
      /<link[^>]+type=["'](application\/(rss|atom)\+xml)["'][^>]*href=["']([^"']+)["']/i
    ) ?? html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+type=["'](application\/(rss|atom)\+xml)["']/i
    );

    if (linkMatch) {
      const href = linkMatch[linkMatch.length === 4 ? 3 : 1];
      return href.startsWith("http") ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
    }
  } catch {
    // HTML fetch failed, fall through to path guessing
  }

  for (const path of KNOWN_FEED_PATHS) {
    try {
      const url = `${origin}${path}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "NewsreaderBot/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
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
