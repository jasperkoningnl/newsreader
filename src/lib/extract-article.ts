import { cleanHtmlText } from "@/lib/html-text";
import { assertSafePublicUrl } from "@/lib/net-safety";

type ExtractedArticle = {
  title: string | null;
  excerpt: string | null;
  paragraphs: string[];
};

function stripTags(input: string): string {
  return cleanHtmlText(input);
}

function extractMeta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(regex);
  return match?.[1] ? stripTags(match[1]) : null;
}

function extractParagraphsFromBlock(block: string): string[] {
  const paragraphMatches = block.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const paragraphs = paragraphMatches
    .map((p) => stripTags(p))
    .filter((p) => p.length > 80)
    .slice(0, 18);

  return paragraphs;
}

export async function extractArticleContent(url: string): Promise<ExtractedArticle | null> {
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
    if (!html) return null;

    const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);

    const block = articleMatch?.[1] ?? mainMatch?.[1] ?? bodyMatch?.[1] ?? html;
    const paragraphs = extractParagraphsFromBlock(block);

    if (paragraphs.length < 2) return null;

    const fallbackTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const title = extractMeta(html, "og:title") ?? (fallbackTitle || null);
    const excerpt = extractMeta(html, "description") ?? extractMeta(html, "og:description") ?? null;

    return { title, excerpt, paragraphs };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
