"use client";

import type { TodayEdition } from "./api/edition/today/route";
import { useEffect, useState } from "react";
import FeedCards from "./feed-cards";

type State =
  | { phase: "loading" }
  | { phase: "done"; edition: TodayEdition }
  | { phase: "error"; message: string };

export default function FeedLoader() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    fetch("/api/edition/today")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to generate edition");
        setState({ phase: "done", edition: data });
      })
      .catch((e) =>
        setState({ phase: "error", message: e instanceof Error ? e.message : "Unknown error" })
      );
  }, []);

  if (state.phase === "done") {
    const { edition } = state;
    return (
      <FeedCards
        items={edition.items}
        createdAt={edition.created_at}
        kind={edition.kind}
        tips={edition.tips}
        saved={edition.saved}
      />
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <p className="text-3xl">⚠️</p>
        <p className="font-semibold">Could not generate feed</p>
        <p className="text-white/50 text-sm max-w-xs">{state.message}</p>
        <button
          onClick={() => {
            setState({ phase: "loading" });
            fetch("/api/edition/today")
              .then(async (res) => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Failed to generate edition");
                setState({ phase: "done", edition: data });
              })
              .catch((e) =>
                setState({ phase: "error", message: e instanceof Error ? e.message : "Unknown error" })
              );
          }}
          className="mt-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-lg"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 text-center">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />
        <div className="absolute inset-0 rounded-full border-2 border-t-white animate-spin" />
      </div>
      <div>
        <p className="font-semibold text-lg">Loading feed…</p>
        <p className="text-white/40 text-sm mt-1">
          Fetching feeds while the curator works
        </p>
      </div>
    </div>
  );
}
