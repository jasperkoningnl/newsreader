import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { articles, sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractArticleContent } from "@/lib/extract-article";
import { cleanHtmlText } from "@/lib/html-text";

export const dynamic = "force-dynamic";

function getFeedHref(from: string | undefined) {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/article/")) {
    return "/";
  }

  return from;
}

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  const feedHref = getFeedHref(from);
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  const [article] = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      description: articles.description,
      image_url: articles.image_url,
      published_at: articles.published_at,
      category: articles.category,
      source: sources.name,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!article) notFound();

  const extracted = await extractArticleContent(article.url).catch(() => null);
  const title = cleanHtmlText(extracted?.title ?? article.title);
  const description = extracted?.excerpt
    ? cleanHtmlText(extracted.excerpt)
    : article.description
      ? cleanHtmlText(article.description)
      : null;

  const publishedAt = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <article className="mx-auto w-full max-w-3xl px-5 pb-20 pt-8 md:px-10 md:pt-12">
      <Link href={feedHref} scroll={false} className="metadata-caps text-white/70 transition-colors hover:text-white">
        ← Back to feed
      </Link>

      <div className="mt-6 flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-white/60">
        <span>{article.source}</span>
        {article.category && (
          <>
            <span className="text-white/25">·</span>
            <span>{article.category}</span>
          </>
        )}
        {publishedAt && (
          <>
            <span className="text-white/25">·</span>
            <span className="normal-case tracking-normal">{publishedAt}</span>
          </>
        )}
      </div>

      <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
        {title}
      </h1>

      {article.image_url && (
        <div className="mt-7 overflow-hidden bg-white/5">
          <img
            src={article.image_url}
            alt=""
            className="h-full max-h-[460px] w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {extracted ? (
        <section className="mt-8 space-y-7">
          {description && (
            <p className="text-lg leading-relaxed text-white/85">
              {description}
            </p>
          )}
          <div className="max-w-2xl space-y-6 text-[1.08rem] leading-9 text-white/90">
            {extracted.paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : (
        description && (
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/85">{description}</p>
        )
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-medium text-white/90 transition-colors hover:bg-white/15"
      >
        Open article
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>

      <div className="mt-6">
        <Link
          href={feedHref}
          scroll={false}
          className="metadata-caps text-white/70 transition-colors hover:text-white"
        >
          ← Back to feed
        </Link>
      </div>
    </article>
  );
}
