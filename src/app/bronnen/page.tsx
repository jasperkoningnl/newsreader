"use client";

import type { Source } from "@/db/schema";
import { useEffect, useRef, useState } from "react";

const CATEGORIES = ["tech", "nieuws", "series", "sport", "games", "wetenschap", "cultuur", "filosofie", "overig"];

type DiscoverState = "idle" | "loading" | "found" | "not-found";

export default function BronnenPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("tech");
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [discoverState, setDiscoverState] = useState<DiscoverState>("idle");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then(setSources)
      .finally(() => setLoading(false));
  }, []);

  async function handleDiscover() {
    if (!urlInput) return;
    setDiscoverState("loading");
    setFeedUrlInput("");
    try {
      const res = await fetch("/api/discover-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json();
      if (data.feedUrl) {
        setFeedUrlInput(data.feedUrl);
        setDiscoverState("found");
      } else {
        setDiscoverState("not-found");
      }
    } catch {
      setDiscoverState("not-found");
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput || !nameInput) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput,
          name: nameInput,
          feed_url: feedUrlInput || null,
          category: categoryInput,
        }),
      });
      if (!res.ok) throw new Error("Toevoegen mislukt");
      const created = await res.json();
      setSources((prev) => [...prev, created]);
      setUrlInput("");
      setNameInput("");
      setFeedUrlInput("");
      setCategoryInput("tech");
      setDiscoverState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(source: Source) {
    const res = await fetch(`/api/sources/${source.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: source.active === 0 ? 1 : 0 }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Bron verwijderen?")) return;
    const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== id));
    }
  }

  async function handleCategoryChange(source: Source, category: string) {
    const res = await fetch(`/api/sources/${source.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
  }

  const grouped = sources.reduce<Record<string, Source[]>>((acc, s) => {
    const cat = s.category ?? "overig";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-4">
      <h1 className="text-2xl font-bold mb-6">Bronnen</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-8 space-y-3 bg-white/5 rounded-xl p-4">
        <div className="flex gap-2">
          <input
            ref={urlRef}
            type="url"
            placeholder="Website URL (bijv. https://theverge.com)"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setDiscoverState("idle");
            }}
            className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/40"
          />
          <button
            type="button"
            onClick={handleDiscover}
            disabled={!urlInput || discoverState === "loading"}
            className="px-3 py-2 text-sm bg-white/10 rounded-lg hover:bg-white/20 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {discoverState === "loading" ? "Zoeken…" : "Vind feed"}
          </button>
        </div>

        {discoverState === "found" && (
          <p className="text-xs text-green-400">✓ Feed gevonden: {feedUrlInput}</p>
        )}
        {discoverState === "not-found" && (
          <div>
            <p className="text-xs text-amber-400 mb-1">Geen feed gevonden. Voer handmatig in:</p>
            <input
              type="url"
              placeholder="Feed URL (RSS/Atom)"
              value={feedUrlInput}
              onChange={(e) => setFeedUrlInput(e.target.value)}
              className="w-full bg-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Naam"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            required
            className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/40"
          />
          <select
            value={categoryInput}
            onChange={(e) => setCategoryInput(e.target.value)}
            className="bg-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/40"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-neutral-900">{c}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={adding || !urlInput || !nameInput}
          className="w-full py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-white/90 disabled:opacity-40 transition-colors"
        >
          {adding ? "Toevoegen…" : "Bron toevoegen"}
        </button>
      </form>

      {/* Source list */}
      {loading ? (
        <p className="text-white/40 text-sm">Laden…</p>
      ) : sources.length === 0 ? (
        <p className="text-white/40 text-sm">Nog geen bronnen. Voeg er één toe.</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category}>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-2">
                  {category}
                </h2>
                <ul className="space-y-2">
                  {items.map((source) => (
                    <li
                      key={source.id}
                      className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
                        source.active ? "bg-white/5" : "bg-white/[0.02] opacity-50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{source.name}</p>
                        <p className="text-xs text-white/40 truncate">{source.url}</p>
                        {source.feed_url && (
                          <p className="text-xs text-white/25 truncate">{source.feed_url}</p>
                        )}
                      </div>
                      <select
                        value={source.category ?? "overig"}
                        onChange={(e) => handleCategoryChange(source, e.target.value)}
                        className="text-xs bg-white/10 rounded-md px-2 py-1 focus:outline-none"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c} className="bg-neutral-900">{c}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleToggle(source)}
                        title={source.active ? "Uitzetten" : "Aanzetten"}
                        className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                          source.active ? "bg-white" : "bg-white/20"
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 bg-black rounded-full mx-auto transition-transform ${
                            source.active ? "translate-x-2" : "-translate-x-2"
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => handleDelete(source.id)}
                        title="Verwijderen"
                        className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
