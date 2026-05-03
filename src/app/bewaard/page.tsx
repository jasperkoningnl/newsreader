"use client";

import { readSavedArticles, writeSavedArticles, type SavedArticle } from "@/lib/saved-articles";
import { useMemo, useState } from "react";

function sectionLabel(savedAt?: string) {
  if (!savedAt) return "History";
  const diff = Date.now() - new Date(savedAt).getTime();
  const day = 86400000;
  if (diff < 2 * day) return "Recently Saved";
  return "History";
}

export default function SavedPage() {
  const [items, setItems] = useState<SavedArticle[]>(() => readSavedArticles());

  const groups = useMemo(() => {
    return items.reduce<Record<string, SavedArticle[]>>((acc, item) => {
      const key = sectionLabel(item.saved_at);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items]);

  function removeItem(id: number) {
    const next = items.filter((item) => item.id !== id);
    setItems(next);
    writeSavedArticles(next);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-14">
      <h1 className="text-5xl font-bold tracking-[-0.03em]">Saved</h1>

      {items.length === 0 ? (
        <p className="mt-4 text-white/60">You have not saved any articles yet.</p>
      ) : (
        <div className="mt-8 space-y-10">
          {(["Recently Saved", "History"] as const).map((section) => {
            const sectionItems = groups[section] ?? [];
            if (!sectionItems.length) return null;
            return (
              <section key={section}>
                <h2 className="metadata-caps text-white/70">{section}</h2>
                <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
                  {sectionItems.map((item) => (
                    <article key={item.id} className="grid gap-4 py-6 md:grid-cols-[240px_1fr_auto] md:items-center">
                      <div className="h-28 overflow-hidden bg-white/5 md:h-32">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0">
                        <p className="metadata-caps text-white/55">{item.source}</p>
                        <h3 className="mt-1 text-3xl font-semibold tracking-[-0.02em] leading-tight">{item.title}</h3>
                        {item.description && <p className="mt-2 text-white/65 line-clamp-2">{item.description}</p>}
                      </a>
                      <button type="button" onClick={() => removeItem(item.id)} className="touch-active h-10 rounded-full border border-white/20 px-4 text-sm text-white/75 hover:bg-white/10">
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
