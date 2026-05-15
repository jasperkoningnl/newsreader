import { db } from "@/db";
import { articles, saved_articles, sources } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { cleanHtmlText } from "@/lib/html-text";
import SavedList from "./saved-list";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const items = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      description: articles.description,
      image_url: articles.image_url,
      source: sources.name,
      saved_at: saved_articles.saved_at,
    })
    .from(saved_articles)
    .innerJoin(articles, eq(saved_articles.article_id, articles.id))
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .orderBy(desc(saved_articles.saved_at));

  const cleanedItems = items.map((item) => ({
    ...item,
    title: cleanHtmlText(item.title),
    description: item.description ? cleanHtmlText(item.description) : null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-14">
      <h1 className="text-5xl font-bold tracking-[-0.03em]">Saved</h1>
      <SavedList items={cleanedItems} />
    </div>
  );
}
