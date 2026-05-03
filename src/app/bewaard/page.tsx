"use client";

import { readSavedArticles, writeSavedArticles, type SavedArticle } from "@/lib/saved-articles";
import { useState } from "react";

export default function BewaardPage() {
  const [items, setItems] = useState<SavedArticle[]>(() => readSavedArticles());

  function removeItem(id: number) {
    const next = items.filter((item) => item.id !== id);
    setItems(next);
    writeSavedArticles(next);
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Bewaard</h1>
        <p className="mt-3 text-white/60">Je hebt nog geen artikelen bewaard.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Bewaard</h1>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-white/50">{item.source}</p>
                <h2 className="mt-1 text-base font-semibold text-white">{item.title}</h2>
                {item.description && <p className="mt-2 text-sm text-white/60 line-clamp-2">{item.description}</p>}
              </a>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80"
              >
                Verwijder
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
