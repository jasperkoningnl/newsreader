import { after } from "next/server";
import { countUnlabeled, fetchPreferenceContext, fetchTopicStates, labelPendingArticles } from "@/lib/taste";
import { fetchCategoryMix } from "@/lib/category-mix";
import MixList from "./mix-list";
import TopicList from "./topic-list";

export const dynamic = "force-dynamic";

export default async function TastePage() {
  const [mixRows, topicStates, unlabeled, pref] = await Promise.all([
    fetchCategoryMix(),
    fetchTopicStates(),
    countUnlabeled(),
    fetchPreferenceContext(),
  ]);

  if (unlabeled > 0) {
    after(async () => {
      try {
        await labelPendingArticles();
      } catch (error) {
        console.error("[taste.backfill] failed", error);
      }
    });
  }

  const sorted = [...topicStates].sort(
    (a, b) =>
      Math.abs(b.weight) - Math.abs(a.weight) ||
      b.likes + b.dislikes + b.saves - (a.likes + a.dislikes + a.saves) ||
      a.label.localeCompare(b.label)
  );

  const sourceRows = [
    { label: "More from", items: [...pref.preferredSources] },
    { label: "Less from", items: [...pref.dislikedSources] },
    { label: "More of category", items: [...pref.preferredTopics] },
    { label: "Less of category", items: [...pref.dislikedTopics] },
  ].filter((r) => r.items.length);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-14">
      <h1 className="text-5xl font-bold tracking-[-0.03em]">Taste</h1>
      <p className="mt-3 max-w-2xl text-white/60">
        The mix sets how many items each category gets in the edition of 10. Within that mix, topics decide what gets picked.
      </p>

      <section className="mt-10">
        <h2 className="metadata-caps text-white/70">Mix per category</h2>
        <MixList initial={mixRows} />
        <p className="mt-3 text-sm text-white/40">A category is the category of the source, set on the Sources page.</p>
      </section>

      {unlabeled > 0 && (
        <p className="mt-6 text-white/60">
          {unlabeled} rated or saved {unlabeled === 1 ? "article is" : "articles are"} still being labeled. Refresh in a minute.
        </p>
      )}

      <section className="mt-14">
        <h2 className="metadata-caps text-white/70">Topics</h2>
        <p className="mt-2 text-sm text-white/50">
          Picked up from what you like, save and thumb down. They set themselves; move a slider to take over. Never keeps a topic out of the feed.
        </p>
        {sorted.length ? (
          <TopicList topics={sorted} />
        ) : (
          <p className="mt-4 text-white/60">No topics yet. Like, save or thumb down a few articles in the feed.</p>
        )}
      </section>

      {sourceRows.length > 0 && (
        <section className="mt-14">
          <h2 className="metadata-caps text-white/70">Sources and categories</h2>
          <p className="mt-2 text-white/50 text-sm">Follows from your thumbs automatically.</p>
          <dl className="mt-4 divide-y divide-white/10 border-y border-white/10">
            {sourceRows.map((row) => (
              <div key={row.label} className="grid gap-1 py-4 md:grid-cols-[200px_1fr]">
                <dt className="text-white/55">{row.label}</dt>
                <dd>{row.items.join(", ")}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
