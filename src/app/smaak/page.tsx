"use client";

import type { TasteEntry } from "@/db/schema";
import { useEffect, useState } from "react";

const TYPES = ["series", "film", "boek", "game", "muziek"];

const TYPE_EMOJI: Record<string, string> = {
  film: "🎬",
  series: "📺",
  boek: "📚",
  game: "🎮",
  muziek: "🎵",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 7) return `${days} dagen geleden`;
  if (days < 30) return `${Math.floor(days / 7)} weken geleden`;
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

function formatAbsoluteDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function SmaakPage() {
  const [entries, setEntries] = useState<TasteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [type, setType] = useState("series");
  const [liked, setLiked] = useState(true);
  const [rating, setRating] = useState(7);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), type, liked, rating, notes: notes.trim() || null }),
      });
      if (!res.ok) throw new Error("Opslaan mislukt");
      const created = await res.json();
      setEntries((prev) => [created, ...prev]);
      setTitle("");
      setNotes("");
      setLiked(true);
      setType("series");
      setRating(7);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await fetch(`/api/taste/${id}`, { method: "DELETE" });
    if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Mijn smaak</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-8 bg-white/5 rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Titel (film, series, boek, game, muziek…)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/40"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="bg-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/40"
          >
            {TYPES.map((t) => (
              <option key={t} value={t} className="bg-neutral-900">
                {TYPE_EMOJI[t]} {t}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-1 text-xs text-white/50 self-center">Rating (1-10)</label>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={rating}
            onChange={(e) => setRating(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="col-span-2 bg-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/40"
          />
        </div>

        <input
          type="text"
          placeholder="Notitie (optioneel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-white/10 rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/40"
        />

        <div className="flex items-center gap-3">
          <span className="text-sm text-white/50">Ik vond het:</span>
          <button
            type="button"
            onClick={() => setLiked(true)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              liked ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/40" : "bg-white/5 text-white/40"
            }`}
          >
            goed
          </button>
          <button
            type="button"
            onClick={() => setLiked(false)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              !liked ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/40" : "bg-white/5 text-white/40"
            }`}
          >
            niets
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="w-full py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-white/90 disabled:opacity-40 transition-colors"
        >
          {saving ? "Opslaan…" : "Toevoegen"}
        </button>
      </form>

      {/* Timeline */}
      {loading ? (
        <p className="text-white/40 text-sm">Laden…</p>
      ) : entries.length === 0 ? (
        <p className="text-white/40 text-sm">Nog niets toegevoegd.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 bg-white/5 rounded-xl px-4 py-3 group"
            >
              <span className="text-xl mt-0.5 flex-shrink-0">{TYPE_EMOJI[entry.type] ?? "✨"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-sm">{entry.title}</span>
                  {entry.rating && <span className="text-xs text-amber-300">{entry.rating}/10</span>}
                  <span
                    className={`text-xs font-medium ${
                      entry.liked ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {entry.liked ? "goed" : "niets"}
                  </span>
                </div>
                {entry.notes && (
                  <p className="text-xs text-white/40 mt-0.5">{entry.notes}</p>
                )}
                <p className="text-xs text-white/25 mt-0.5">
                  {entry.type} · {timeAgo(entry.added_at ?? "")} · {formatAbsoluteDate(entry.added_at ?? "")}
                </p>
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                className="text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
                title="Verwijderen"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
