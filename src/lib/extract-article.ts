import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import { cleanHtmlText } from "@/lib/html-text";
import { assertSafePublicUrl } from "@/lib/net-safety";
import { cleanArticleContent, stripPageClutter } from "@/lib/article-cleanup";

export type ExtractedArticle = {
  title: string | null;
  excerpt: string | null;
  image_url: string | null;
  byline: string | null;
  site_name: string | null;
  html: string | null;
};

function extractMeta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(regex);
  return match?.[1] ? cleanHtmlText(match[1]) : null;
}

function absoluteUrl(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeArticleHtml(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "figure", "figcaption",
      "img", "a", "strong", "b", "em", "i", "code", "pre", "hr", "br", "sup", "sub",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "loading", "referrerpolicy"],
    },
    allowedSchemes: ["http", "https"],
    transformTags: {
      h1: "h2",
      h5: "h4",
      h6: "h4",
      a: (tagName, attribs) => {
        const href = absoluteUrl(attribs.href, baseUrl);
        const next: Record<string, string> = href ? { href, target: "_blank", rel: "noopener noreferrer" } : {};
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        // Lazy-loaders often leave a placeholder in src and the real image in data-src.
        const raw = attribs["data-src"] ?? attribs["data-original"] ?? attribs.src;
        const src = absoluteUrl(raw, baseUrl);
        const next: Record<string, string> = src
          ? { src, alt: attribs.alt ?? "", loading: "lazy", referrerpolicy: "no-referrer" }
          : {};
        return { tagName, attribs: next };
      },
    },
    exclusiveFilter: (frame) =>
      (frame.tag === "img" && !frame.attribs.src) ||
      (["p", "li", "figcaption", "blockquote"].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren.length),
  });
}

export async function fetchArticleHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const safeUrl = await assertSafePublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(safeUrl.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheFeedBot/1.0; +https://thefeed.local)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html ? { html, finalUrl: res.url || safeUrl.toString() } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseArticleHtml(html: string, url: string): ExtractedArticle {
  const fallbackTitle = cleanHtmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const metaTitle = extractMeta(html, "og:title") ?? (fallbackTitle || null);
  const metaExcerpt = extractMeta(html, "og:description") ?? extractMeta(html, "description");
  const image_url = absoluteUrl(extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image") ?? undefined, url);

  let readable: ReturnType<Readability["parse"]> = null;
  try {
    const { document } = parseHTML(html);
    if (document.documentElement) {
      stripPageClutter(document as unknown as Document);
      readable = new Readability(document as unknown as Document).parse();
    }
  } catch (error) {
    console.warn("[extract-article] readability failed", url, error);
  }

  const cleaned = readable?.content ? sanitizeArticleHtml(cleanArticleContent(readable.content, image_url), url) : "";
  const textLength = cleanHtmlText(cleaned).length;

  return {
    title: metaTitle ?? (readable?.title ? cleanHtmlText(readable.title) : null),
    excerpt: metaExcerpt ?? (readable?.excerpt ? cleanHtmlText(readable.excerpt) : null),
    image_url,
    byline: readable?.byline ? cleanHtmlText(readable.byline) : null,
    site_name: extractMeta(html, "og:site_name") ?? (readable?.siteName ? cleanHtmlText(readable.siteName) : null),
    html: textLength >= 400 ? cleaned : null,
  };
}

export async function extractArticleContent(url: string): Promise<ExtractedArticle | null> {
  const page = await fetchArticleHtml(url);
  if (!page) return null;
  return parseArticleHtml(page.html, page.finalUrl);
}
