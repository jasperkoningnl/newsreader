"use client";

import type { TasteEntry } from "@/db/schema";
import { useEffect, useState } from "react";

const TYPES = ["series", "film", "boek", "game", "muziek"];
const TYPE_LABELS: Record<string, string> = { series: "Series", film: "Film", boek: "Boek", game: "Game", muziek: "Muziek" };

export default function TastePage() {
  const [entries, setEntries] = useState<TasteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("series");
  const [liked, setLiked] = useState(true);
  const [rating, setRating] = useState(7);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/taste").then((r) => r.json()).then(setEntries).finally(() => setLoading(false)); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/taste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), type, liked, rating, notes: notes.trim() || null }) });
      if (!res.ok) throw new Error("Opslaan mislukt");
      const created = await res.json();
      setEntries((prev) => [created, ...prev]);
      setTitle("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
      <h1 className="mt-2 text-6xl font-bold tracking-[-0.03em]">Smaak</h1>
      <p className="mt-2 max-w-4xl text-2xl text-white/70">Jouw culturele voetafdruk.</p>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <form onSubmit={handleAdd} className="space-y-4">
          <h2 className="text-5xl font-semibold tracking-[-0.02em]">Nieuw item</h2>
          <div><p className="metadata-caps mb-2 text-white/70">Titel</p><input value={title} onChange={(e)=>setTitle(e.target.value)} className="h-14 w-full rounded-xl bg-white/10 px-4 text-lg" /></div>
          <div><p className="metadata-caps mb-2 text-white/70">Medium</p><select value={type} onChange={(e)=>setType(e.target.value)} className="h-14 w-full rounded-xl bg-white/10 px-4 text-lg">{TYPES.map(t=><option key={t} value={t} className="bg-black">{TYPE_LABELS[t]}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><p className="metadata-caps mb-2 text-white/70">Score (1-10)</p><input type="number" min={1} max={10} value={rating} onChange={(e)=>setRating(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-14 w-full rounded-xl bg-white/10 px-4 text-lg" /></div><div><p className="metadata-caps mb-2 text-white/70">Oordeel</p><div className="grid h-14 grid-cols-2 rounded-xl bg-white/10 p-1"><button type="button" onClick={()=>setLiked(true)} className={`rounded-lg ${liked?"bg-white/20":""}`}>Goed</button><button type="button" onClick={()=>setLiked(false)} className={`rounded-lg ${!liked?"bg-white/20":""}`}>Sla over</button></div></div></div>
          <div><p className="metadata-caps mb-2 text-white/70">Notitie</p><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="h-36 w-full rounded-xl bg-white/10 p-4" /></div>
          {error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <button disabled={submitting} className="touch-active h-14 w-full rounded-xl bg-white text-black text-sm tracking-[.2em] uppercase disabled:opacity-50">{submitting ? "Opslaan…" : "Toevoegen"}</button>
        </form>

        <section>
          <div className="flex items-end justify-between border-b border-white/10 pb-5"><h2 className="text-5xl font-semibold tracking-[-0.02em]">Recent</h2><p className="metadata-caps text-white/60">Op datum</p></div>
          <ul className="divide-y divide-white/10">{entries.map(entry=><li key={entry.id} className="grid grid-cols-[1fr_auto] gap-4 py-6"><div><p className="metadata-caps text-white/60">{TYPE_LABELS[entry.type] ?? entry.type} • {new Date(entry.added_at ?? "").toLocaleDateString("nl-NL")}</p><h3 className="mt-2 text-4xl font-semibold tracking-[-0.02em]">{entry.title}</h3>{entry.notes && <p className="mt-2 text-white/70">{entry.notes}</p>}</div><div className="text-right"><div className="text-6xl leading-none">{entry.rating ?? "-"}<span className="text-2xl text-white/50">/10</span></div><div className="mt-3 inline-block rounded-full border border-white/20 px-3 py-1 text-sm">{entry.liked ? "Goed" : "Sla over"}</div></div></li>)}</ul>
          {loading && <p className="mt-3 text-white/50">Laden…</p>}
        </section>
      </div>
    </div>
  );
}
