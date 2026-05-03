"use client";

import type { EditionItem } from "./api/edition/today/route";
import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { readSavedArticles, writeSavedArticles, type SavedArticle } from "@/lib/saved-articles";

type RefreshState = "idle" | "busy" | "error";

const BATCH_SIZE = 15;

function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<RefreshState>("idle");
  const [status, setStatus] = useState("");

  async function handleRefresh() {
    setState("busy");
    let totalOk = 0;
    let totalFailed = 0;
    const failures: { source: string; error: string }[] = [];

    try {
      // Fetch first batch to discover total
      setStatus("Fetching feeds…");
      const firstRes = await fetch(`/api/fetch-feeds?offset=0&limit=${BATCH_SIZE}`, { method: "POST" });
      const firstData = await firstRes.json();
      if (!firstRes.ok) throw new Error(firstData.error ?? "Failed to fetch feeds");

      const total: number = firstData.total;
      totalOk += firstData.fetched_sources;
      totalFailed += firstData.failed_sources;
      failures.push(...(firstData.failures ?? []));

      const batches = Math.ceil(total / BATCH_SIZE);

      for (let batch = 1; batch < batches; batch++) {
        const offset = batch * BATCH_SIZE;
        setStatus(`Fetching feeds ${Math.min(offset + BATCH_SIZE, total)}/${total}…`);
        const res = await fetch(`/api/fetch-feeds?offset=${offset}&limit=${BATCH_SIZE}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch feeds");
        totalOk += data.fetched_sources;
        totalFailed += data.failed_sources;
        failures.push(...(data.failures ?? []));
      }

      setStatus("Generating edition…");
      const genRes = await fetch("/api/edition/generate", { method: "POST" });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error ?? "Failed to generate edition");

      const failureNote = failures.length
        ? ` — ${failures.length} failed: ${failures.map((f) => f.source).join(", ")}`
        : "";
      setStatus(`${genData.count} items · ${totalOk} feeds ok · ${totalFailed} failed${failureNote}`);
      setState("idle");
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button
        onClick={handleRefresh}
        disabled={state === "busy"}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm transition-colors disabled:opacity-40"
      >
        <svg
          className={`w-4 h-4 flex-shrink-0 ${state === "busy" ? "animate-spin" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {state === "busy" ? "Working…" : "Refresh feed"}
      </button>
      {status && (
        <p className={`text-xs ${state === "error" ? "text-red-400" : "text-white/40"}`}>
          {status}
        </p>
      )}
    </div>
  );
}

function Card({ item, index }: { item: EditionItem; index: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [liked, setLiked] = useState(item.liked);
  const [liking, setLiking] = useState(false);
  const [saved, setSaved] = useState(() => {
    const savedItems = readSavedArticles();
    return savedItems.some((savedItem) => savedItem.id === item.id);
  });

  const handleSave = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const savedItems = readSavedArticles();
    if (saved) {
      writeSavedArticles(savedItems.filter((savedItem) => savedItem.id !== item.id));
      setSaved(false);
      return;
    }

    const articleToSave: SavedArticle = {
      id: item.id,
      title: item.title,
      url: item.url,
      description: item.description,
      image_url: item.image_url,
      published_at: item.published_at,
      category: item.category,
      source: item.source,
      saved_at: new Date().toISOString(),
    };

    writeSavedArticles([articleToSave, ...savedItems.filter((savedItem) => savedItem.id !== item.id)]);
    setSaved(true);
  };

  const handleLike = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (liking) return;
    const nextLiked = !liked;
    setLiking(true);
    try {
      const res = await fetch(`/api/articles/${item.id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked: nextLiked }),
      });
      if (res.ok) setLiked(nextLiked);
    } finally {
      setLiking(false);
    }
  };

  const publishedAt = item.published_at
    ? new Date(item.published_at).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col h-full snap-start overflow-hidden select-none md:h-[48vh] md:min-h-[420px] md:rounded-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {item.image_url && !imgFailed ? (
        <img
          src={item.image_url}
          alt=""
          onError={() => setImgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `hsl(${(index * 47) % 360}, 30%, 12%)`,
          }}
        />
      )}

      <div className="absolute inset-0 story-scrim" />
      {/* content */}
      <div className="relative mt-auto px-5 pb-5 md:px-8 md:pb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">
            {item.source}
          </span>
          {item.category && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-xs text-white/35 uppercase tracking-wide">
                {item.category}
              </span>
            </>
          )}
          {publishedAt && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-xs text-white/35 tracking-wide">{publishedAt}</span>
            </>
          )}
        </div>
        <h2 className="text-[2rem] md:text-[2.2rem] font-bold leading-[1.1] tracking-[-0.03em] text-white">
          {item.title}
        </h2>
        {item.description && (
          <p className="mt-2 text-sm text-white/60 line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-xs text-white/40">
            <span>Read more</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={saved ? "Remove from saved" : "Save article"}
              onClick={handleSave}
              className="touch-active rounded-full border border-white/30 p-2 text-white/80 hover:bg-white/10"
            >
              {saved ? "★" : "☆"}
            </button>
            <button
              type="button"
              aria-label={liked ? "Unlike article" : "Like article"}
              onClick={handleLike}
              disabled={liking}
              className="touch-active rounded-full border border-white/30 p-2 text-white/80 hover:bg-white/10 disabled:opacity-60"
            >
              {liked ? "♥" : liking ? "…" : "♡"}
            </button>
          </div>
        </div>
      </div>
    </a>
  );
}

function EndCard({ createdAt }: { createdAt: string | null }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="relative flex flex-col h-full snap-start items-center justify-center px-8 text-center bg-black md:col-span-2 md:h-56 md:rounded-xl md:snap-align-none">
      <div className="text-5xl mb-6">🌿</div>
      <h2 className="text-2xl font-bold mb-2">That’s it for today</h2>
      <p className="text-white/40 text-sm">
        Next edition {tomorrowStr}
      </p>
      {createdAt && (
        <p className="mt-6 text-xs text-white/20">
          Edition from{" "}
          {new Date(createdAt).toLocaleDateString("en-US", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      )}
      <RefreshButton />
    </div>
  );
}

export default function FeedCards({
  items,
  createdAt,
}: {
  items: EditionItem[];
  createdAt: string | null;
}) {
  return (
    <div className="h-full overflow-y-scroll snap-y snap-mandatory md:h-auto md:overflow-visible md:snap-none md:grid md:grid-cols-2 md:gap-6 md:p-6 md:bg-[#141313]">
      {items.map((item, i) => (
        <Card key={item.id} item={item} index={i} />
      ))}
      <EndCard createdAt={createdAt} />
    </div>
  );
}
