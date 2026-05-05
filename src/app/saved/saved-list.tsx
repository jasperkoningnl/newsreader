"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";

type Item = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  image_url: string | null;
  source: string;
  saved_at: string | null;
};

function sectionLabel(savedAt: string | null) {
  if (!savedAt) return "History";
  const diff = Date.now() - new Date(savedAt).getTime();
  const day = 86400000;
  if (diff < 2 * day) return "Recently Saved";
  return "History";
}

export default function SavedList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<number | null>(null);

  const groups = items.reduce<Record<string, Item[]>>((acc, item) => {
    const key = sectionLabel(item.saved_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  async function removeItem(id: number) {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/articles/${id}/save`, { method: "DELETE" });
      if (res.ok) startTransition(() => router.refresh());
    } finally {
      setRemovingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="mt-4 text-white/60">You have not saved any articles yet.</p>;
  }

  return (
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
                  <Link href={`/article/${item.id}`} className="min-w-0">
                    <p className="metadata-caps text-white/55">{item.source}</p>
                    <h3 className="mt-1 text-3xl font-semibold tracking-[-0.02em] leading-tight">{item.title}</h3>
                    {item.description && <p className="mt-2 text-white/65 line-clamp-2">{item.description}</p>}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={removingId === item.id || pending}
                    className="touch-active h-10 rounded-full border border-white/20 px-4 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50"
                  >
                    {removingId === item.id ? "Removing…" : "Remove"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
