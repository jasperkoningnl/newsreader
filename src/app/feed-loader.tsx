"use client";

import type { EditionItem } from "./api/edition/today/route";
import { useEffect, useState } from "react";
import FeedCards from "./feed-cards";

type State =
  | { phase: "fetching-feeds" }
  | { phase: "generating" }
  | { phase: "done"; items: EditionItem[]; createdAt: string | null }
  | { phase: "error"; message: string };

export default function FeedLoader() {
  const [state, setState] = useState<State>({ phase: "fetching-feeds" });

  useEffect(() => {
    async function run() {
      try {
        // Stap 1: feeds ophalen
        setState({ phase: "fetching-feeds" });
        await fetch("/api/fetch-feeds", { method: "POST" });

        // Stap 2: editie genereren
        setState({ phase: "generating" });
        const genRes = await fetch("/api/edition/generate", { method: "POST" });
        if (!genRes.ok) {
          const err = await genRes.json();
          throw new Error(err.error ?? "Genereren mislukt");
        }

        // Stap 3: editie ophalen
        const todayRes = await fetch("/api/edition/today");
        if (!todayRes.ok) throw new Error("Ophalen mislukt");
        const edition = await todayRes.json();
        setState({ phase: "done", items: edition.items, createdAt: edition.created_at });
      } catch (e) {
        setState({ phase: "error", message: e instanceof Error ? e.message : "Onbekende fout" });
      }
    }
    run();
  }, []);

  if (state.phase === "done") {
    return <FeedCards items={state.items} createdAt={state.createdAt} />;
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <p className="text-3xl">⚠️</p>
        <p className="font-semibold">Kon geen feed genereren</p>
        <p className="text-white/50 text-sm max-w-xs">{state.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 bg-white text-black text-sm font-medium rounded-lg"
        >
          Probeer opnieuw
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
        <p className="font-semibold text-lg">
          {state.phase === "fetching-feeds" ? "Feeds ophalen…" : "Curator aan het werk…"}
        </p>
        <p className="text-white/40 text-sm mt-1">
          {state.phase === "fetching-feeds"
            ? "Artikelen binnenhalen uit alle bronnen"
            : "Claude selecteert je 10 items voor vandaag"}
        </p>
      </div>
    </div>
  );
}
