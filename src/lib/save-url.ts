import { db } from "@/db";
import { articles, saved_articles, sources } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { fetchArticleHtml, parseArticleHtml } from "./extract-article";
import { findSourceByHost } from "./promote-signals";

export class SaveUrlError extends Error {}

export function pickUrl(...candidates: (string | null | undefined)[]): string | null {
  for (const value of candidates) {
    // Android share sheets often put the link inside `text` ("Look at this https://…").
    const match = value?.match(/https?:\/\/[^\s<>"']+/i);
    if (match) return match[0].replace(/[).,;!?]+$/, "");
  }
  return null;
}

async function findArticleId(url: string): Promise<number | null> {
  const [row] = await db.select({ id: articles.id }).from(articles).where(eq(articles.url, url)).limit(1);
  return row?.id ?? null;
}

async function sourceIdFor(url: string, siteName: string | null): Promise<number> {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const existing = await findSourceByHost(host);
  if (existing) return existing;

  // Inactive: saving one article should not subscribe the whole site to the daily feed.
  const [created] = await db
    .insert(sources)
    .values({ name: siteName || host, url: `https://${host}`, active: 0 })
    .onConflictDoNothing({ target: sources.url })
    .returning({ id: sources.id });
  if (created) return created.id;

  const [retry] = await db.select({ id: sources.id }).from(sources).where(eq(sources.url, `https://${host}`)).limit(1);
  if (!retry) throw new Error(`failed to create source for ${host}`);
  return retry.id;
}

export async function saveUrl(rawUrl: string, fallbackTitle: string | null): Promise<{ article_id: number; title: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SaveUrlError("Ongeldige URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SaveUrlError("Alleen http(s)-links");

  let articleId = await findArticleId(url.toString());

  if (!articleId) {
    const page = await fetchArticleHtml(url.toString()).catch(() => null);
    const finalUrl = page?.finalUrl ?? url.toString();
    articleId = finalUrl !== url.toString() ? await findArticleId(finalUrl) : null;

    if (!articleId) {
      const meta = page ? parseArticleHtml(page.html, finalUrl) : null;
      const sourceId = await sourceIdFor(finalUrl, meta?.site_name ?? null);
      await db
        .insert(articles)
        .values({
          source_id: sourceId,
          title: meta?.title || fallbackTitle || finalUrl,
          url: finalUrl,
          description: meta?.excerpt?.slice(0, 500) ?? null,
          image_url: meta?.image_url ?? null,
          fetched_at: sql`(datetime('now'))`,
          read: 1,
        })
        .onConflictDoNothing({ target: articles.url });
      articleId = await findArticleId(finalUrl);
    }
  }

  if (!articleId) throw new Error(`failed to store article for ${url}`);

  await db
    .insert(saved_articles)
    .values({ article_id: articleId })
    .onConflictDoNothing({ target: saved_articles.article_id });

  const [row] = await db.select({ title: articles.title }).from(articles).where(eq(articles.id, articleId)).limit(1);
  return { article_id: articleId, title: row?.title ?? url.toString() };
}
