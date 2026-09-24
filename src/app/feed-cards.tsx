"use client";

import type { EditionItem, SavedThisWeek } from "./api/edition/today/route";
import type { SundayTip } from "@/lib/generate-sunday";
import { SavedThisWeekCard, TipCard } from "./sunday-cards";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type RefreshState = "idle" | "busy" | "error";

const BATCH_SIZE = 15;
const FEED_SCROLL_STORAGE_PREFIX = "newsreader:feed-scroll:";

type SavedFeedPosition = {
  itemId: number | null;
  scrollTop: number;
};

function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<RefreshState>("idle");
  const [status, setStatus] = useState("");

  async function handleRefresh() {
    setState("busy");
    let totalOk = 0;
    let totalFailed = 0;
    let totalDisabled = 0;
    const failures: { source: string; error: string }[] = [];
    const autoDisabled: string[] = [];

    try {
      // Fetch first batch to discover total
      setStatus("Fetching feeds…");
      const firstRes = await fetch(`/api/fetch-feeds?offset=0&limit=${BATCH_SIZE}`, { method: "POST" });
      const firstData = await firstRes.json();
      if (!firstRes.ok) throw new Error(firstData.error ?? "Failed to fetch feeds");

      const total: number = firstData.total;
      totalOk += firstData.fetched_sources;
      totalFailed += firstData.failed_sources;
      totalDisabled += firstData.auto_disabled_sources ?? 0;
      failures.push(...(firstData.failures ?? []));
      autoDisabled.push(...(firstData.auto_disabled ?? []));

      const batches = Math.ceil(total / BATCH_SIZE);

      for (let batch = 1; batch < batches; batch++) {
        const offset = batch * BATCH_SIZE;
        setStatus(`Fetching feeds ${Math.min(offset + BATCH_SIZE, total)}/${total}…`);
        const res = await fetch(`/api/fetch-feeds?offset=${offset}&limit=${BATCH_SIZE}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch feeds");
        totalOk += data.fetched_sources;
        totalFailed += data.failed_sources;
        totalDisabled += data.auto_disabled_sources ?? 0;
        failures.push(...(data.failures ?? []));
        autoDisabled.push(...(data.auto_disabled ?? []));
      }

      setStatus("Generating edition…");
      const genRes = await fetch("/api/edition/generate", { method: "POST" });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error ?? "Failed to generate edition");

      const failureNote = failures.length
        ? ` — ${failures.length} failed: ${failures.map((f) => f.source).join(", ")}`
        : "";
      const disabledNote = totalDisabled
        ? ` · ${totalDisabled} auto-disabled${autoDisabled.length ? `: ${autoDisabled.join(", ")}` : ""}`
        : "";
      setStatus(`${genData.count} items · ${totalOk} feeds ok · ${totalFailed} failed${failureNote}${disabledNote}`);
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

function Card({
  item,
  index,
  feedHref,
  onOpen,
}: {
  item: EditionItem;
  index: number;
  feedHref: string;
  onOpen: (itemId: number) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [liked, setLiked] = useState(item.liked);
  const [disliked, setDisliked] = useState(item.disliked);
  const [liking, setLiking] = useState(false);
  const [saved, setSaved] = useState(item.saved);

  const handleSave = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch(`/api/articles/${item.id}/save`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) setSaved(!next);
    } catch {
      setSaved(!next);
    }
  };

  const handleLike = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (liking) return;
    setLiking(true);
    try {
      if (liked) {
        const res = await fetch(`/api/articles/${item.id}/like`, { method: "DELETE" });
        if (res.ok) setLiked(false);
      } else {
        const res = await fetch(`/api/articles/${item.id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked: true }),
        });
        if (res.ok) {
          setLiked(true);
          setDisliked(false);
        }
      }
    } finally {
      setLiking(false);
    }
  };

  const handleDislike = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (liking) return;
    setLiking(true);
    try {
      if (disliked) {
        const res = await fetch(`/api/articles/${item.id}/like`, { method: "DELETE" });
        if (res.ok) setDisliked(false);
      } else {
        const res = await fetch(`/api/articles/${item.id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked: false }),
        });
        if (res.ok) {
          setDisliked(true);
          setLiked(false);
        }
      }
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
    <Link
      id={`feed-item-${item.id}`}
      href={{ pathname: `/article/${item.id}`, query: { from: feedHref } }}
      onClick={() => onOpen(item.id)}
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
      {item.role === "longread" && (
        <span className="absolute left-5 top-5 md:left-8 md:top-7 metadata-caps text-white/80">
          The Sunday Edition
        </span>
      )}
      {item.is_paywall && (
        <span
          aria-label="Behind paywall"
          title="Behind paywall"
          className="absolute right-4 top-4 md:right-6 md:top-6 flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/40 text-sm font-semibold text-white backdrop-blur-sm"
        >
          €
        </span>
      )}
      {/* content */}
      <div className="relative mt-auto px-5 pb-5 md:px-8 md:pb-8">
        {(item.role === "longread" || item.role === "background") && (
          <span className="mb-3 inline-block bg-white px-2 py-1 metadata-caps text-black">
            {item.role === "longread" ? "Longread" : "Background"}
            {item.minutes ? ` · ${item.minutes} min` : ""}
          </span>
        )}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">
            {item.source}
          </span>
          {item.signal_score > 0 && (
            <span
              aria-label={`Signaal ${item.signal_score.toFixed(1)}`}
              title={`Opgepikt uit jouw activiteit (signaal=${item.signal_score.toFixed(1)})`}
              className="text-xs leading-none"
            >
              🔥
            </span>
          )}
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
            <span>Open article</span>
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
              className={`touch-active rounded-full border p-2 hover:bg-white/10 disabled:opacity-60 ${
                liked ? "border-white bg-white/15 text-white" : "border-white/30 text-white/80"
              }`}
            >
              <svg className="w-4 h-4" fill={liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10H9.236a2 2 0 00-1.789 1.106L7 12v8m0 0H4a1 1 0 01-1-1v-7a1 1 0 011-1h3" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={disliked ? "Remove dislike" : "Less like this"}
              onClick={handleDislike}
              disabled={liking}
              className={`touch-active rounded-full border p-2 hover:bg-white/10 disabled:opacity-60 ${
                disliked ? "border-white bg-white/15 text-white" : "border-white/30 text-white/80"
              }`}
            >
              <svg className="w-4 h-4" fill={disliked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.017c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h4.764a2 2 0 001.789-1.106L17 12V4m0 0h3a1 1 0 011 1v7a1 1 0 01-1 1h-3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

function EndCard({
  createdAt,
  archived,
  sunday,
  olderDate,
  newerDate,
}: {
  createdAt: string | null;
  archived: boolean;
  sunday: boolean;
  olderDate: string | null;
  newerDate: string | null;
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const linkClass = "text-white/60 underline-offset-4 hover:text-white hover:underline";

  return (
    <div className="relative flex flex-col h-full snap-start items-center justify-center px-8 text-center bg-black md:col-span-2 md:h-56 md:rounded-xl md:snap-align-none">
      <div className="text-5xl mb-6">{archived ? "📰" : "🌿"}</div>
      <h2 className="text-2xl font-bold mb-2">
        {archived ? "End of this edition" : sunday ? "That’s it for this week" : "That’s it for today"}
      </h2>
      {!archived && (
        <p className="text-white/40 text-sm">Next edition {tomorrowStr}</p>
      )}
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
      {(olderDate || newerDate || archived) && (
        <p className="mt-3 flex items-center gap-3 text-xs text-white/30">
          {olderDate ? (
            <Link href={`/?date=${olderDate}`} className={linkClass}>
              ← Previous edition
            </Link>
          ) : null}
          {olderDate && (newerDate || archived) ? <span>·</span> : null}
          {archived ? (
            newerDate ? (
              <Link href={`/?date=${newerDate}`} className={linkClass}>
                Next edition →
              </Link>
            ) : (
              <Link href="/" className={linkClass}>
                Back to today →
              </Link>
            )
          ) : null}
        </p>
      )}
      {!archived && <RefreshButton />}
    </div>
  );
}

export default function FeedCards({
  items,
  createdAt,
  kind = "daily",
  tips = [],
  saved = [],
  archived = false,
  olderDate = null,
  newerDate = null,
  feedHref = "/",
}: {
  items: EditionItem[];
  createdAt: string | null;
  kind?: "daily" | "sunday";
  tips?: SundayTip[];
  saved?: SavedThisWeek[];
  archived?: boolean;
  olderDate?: string | null;
  newerDate?: string | null;
  feedHref?: string;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const storageKey = `${FEED_SCROLL_STORAGE_PREFIX}${feedHref}`;

  const saveScrollPosition = useCallback((itemId: number | null = null) => {
    const feedScroller = feedRef.current;
    const mainScroller = document.querySelector("main");
    const scrollTop = Math.max(feedScroller?.scrollTop ?? 0, mainScroller?.scrollTop ?? 0);
    const position: SavedFeedPosition = { itemId, scrollTop };
    sessionStorage.setItem(storageKey, JSON.stringify(position));
  }, [storageKey]);

  useEffect(() => {
    const feedScroller = feedRef.current;
    const mainScroller = document.querySelector("main");
    const rawPosition = sessionStorage.getItem(storageKey);
    if (!rawPosition) return;

    let savedPosition: SavedFeedPosition | null = null;
    try {
      savedPosition = JSON.parse(rawPosition) as SavedFeedPosition;
    } catch {
      sessionStorage.removeItem(storageKey);
      return;
    }

    const restore = () => {
      if (typeof savedPosition?.scrollTop === "number") {
        if (feedScroller) feedScroller.scrollTop = savedPosition.scrollTop;
        if (mainScroller) mainScroller.scrollTop = savedPosition.scrollTop;
      }

      if (savedPosition?.itemId) {
        document
          .getElementById(`feed-item-${savedPosition.itemId}`)
          ?.scrollIntoView({ block: "start" });
      }
    };

    const animationFrame = requestAnimationFrame(restore);
    const timeout = window.setTimeout(restore, 120);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [storageKey]);

  // Sunday: longread and background open the edition, the tips follow, then the highlights.
  const lead = kind === "sunday" ? items.filter((i) => i.role === "longread" || i.role === "background") : [];
  const rest = kind === "sunday" ? items.filter((i) => i.role !== "longread" && i.role !== "background") : items;

  return (
    <div
      ref={feedRef}
      onScroll={() => saveScrollPosition()}
      className="h-full overflow-y-scroll snap-y snap-mandatory md:h-auto md:overflow-visible md:snap-none md:grid md:grid-cols-2 md:gap-6 md:p-6 md:bg-[#141313]"
    >
      {lead.map((item, i) => (
        <Card key={item.id} item={item} index={i} feedHref={feedHref} onOpen={saveScrollPosition} />
      ))}
      {tips.map((tip) => (
        <TipCard key={tip.article_id} tip={tip} feedHref={feedHref} />
      ))}
      {rest.map((item, i) => (
        <Card key={item.id} item={item} index={lead.length + i} feedHref={feedHref} onOpen={saveScrollPosition} />
      ))}
      {saved.length > 0 && <SavedThisWeekCard saved={saved} />}
      <EndCard
        createdAt={createdAt}
        archived={archived}
        sunday={kind === "sunday"}
        olderDate={olderDate}
        newerDate={newerDate}
      />
    </div>
  );
}
