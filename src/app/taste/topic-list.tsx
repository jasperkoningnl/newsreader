"use client";

import { useRef, useState } from "react";
import type { TopicState } from "@/lib/taste";

const WEIGHT_LABELS: Record<number, string> = { [-2]: "Never", [-1]: "Less", 0: "Neutral", 1: "More", 2: "Lots" };

function signalSummary(t: TopicState) {
  const parts = [
    t.likes && `${t.likes} liked`,
    t.saves && `${t.saves} saved`,
    t.dislikes && `${t.dislikes} thumbs down`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No signals";
}

function TopicRow({ topic }: { topic: TopicState }) {
  const [manual, setManual] = useState<number | null>(topic.manual_weight);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weight = manual ?? topic.auto_weight;

  function persist(next: number | null) {
    setManual(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const res = await fetch(`/api/topics/${topic.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weight: next }),
        });
        setStatus(res.ok ? "idle" : "error");
      } catch {
        setStatus("error");
      }
    }, 400);
  }

  return (
    <li className="grid gap-3 py-5 md:grid-cols-[1fr_320px] md:items-center md:gap-8">
      <div className="min-w-0">
        <h3 className="text-xl font-semibold tracking-[-0.01em] leading-snug">{topic.label}</h3>
        <p className="mt-1 text-sm text-white/50">{signalSummary(topic)}</p>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className={weight < 0 ? "text-white/60" : "text-white"}>{WEIGHT_LABELS[weight]}</span>
          {manual === null ? (
            <span className="text-white/40">Automatic</span>
          ) : (
            <button type="button" onClick={() => persist(null)} className="text-white/60 underline underline-offset-4 hover:text-white">
              Back to automatic ({WEIGHT_LABELS[topic.auto_weight]})
            </button>
          )}
        </div>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={weight}
          onChange={(e) => persist(Number(e.target.value))}
          aria-label={`Taste for ${topic.label}`}
          className="mt-2 w-full accent-white"
        />
        <div className="flex justify-between text-[11px] text-white/35">
          <span>Never</span>
          <span>Neutral</span>
          <span>Lots</span>
        </div>
        {status === "error" && <p className="mt-1 text-sm text-red-400">Could not save. Try again.</p>}
      </div>
    </li>
  );
}

export default function TopicList({ topics }: { topics: TopicState[] }) {
  return (
    <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
      {topics.map((t) => (
        <TopicRow key={t.id} topic={t} />
      ))}
    </ul>
  );
}
