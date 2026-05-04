"use client";

import type { Source } from "@/db/schema";
import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_CATEGORIES = ["tech", "news", "series", "sports", "games", "science", "culture", "philosophy", "other"];
type DiscoverState = "idle" | "loading" | "found" | "not-found";

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("tech");
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [feedUrlInput, setFeedUrlInput] = useState("");
  const [discoverState, setDiscoverState] = useState<DiscoverState>("idle");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const fromSources = sources.map((s) => (s.category ?? "other").trim()).filter(Boolean);
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...fromSources])).sort((a, b) => a.localeCompare(b));
  }, [sources]);

  useEffect(() => {
    fetch("/api/sources").then((r) => r.json()).then(setSources).finally(() => setLoading(false));
  }, []);

  async function handleDiscover() { if (!urlInput) return; setDiscoverState("loading"); setFeedUrlInput(""); try { const res = await fetch("/api/discover-feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput }) }); const data = await res.json(); if (data.feedUrl) { setFeedUrlInput(data.feedUrl); setDiscoverState("found"); } else setDiscoverState("not-found"); } catch { setDiscoverState("not-found"); } }
  async function handleAdd(e: React.FormEvent) { e.preventDefault(); if (!urlInput || !nameInput) return; setAdding(true); setError(null); try { const chosenCategory = (newCategoryInput.trim() || categoryInput).trim(); const res = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput, name: nameInput, feed_url: feedUrlInput || null, category: chosenCategory || "other" }) }); if (!res.ok) throw new Error("Failed to add source"); const created = await res.json(); setSources((prev) => [...prev, created]); setUrlInput(""); setNameInput(""); setFeedUrlInput(""); setCategoryInput("tech"); setNewCategoryInput(""); setDiscoverState("idle"); urlRef.current?.focus(); } catch (err) { setError(err instanceof Error ? err.message : "Unknown error"); } finally { setAdding(false); } }
  async function handleToggle(source: Source) { const res = await fetch(`/api/sources/${source.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: source.active === 0 ? 1 : 0 }) }); if (res.ok) { const updated = await res.json(); setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s))); } }
  async function handleCategoryChange(source: Source, category: string) { const res = await fetch(`/api/sources/${source.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }) }); if (res.ok) { const updated = await res.json(); setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s))); } }
  async function handleDelete(source: Source) {
    const confirmed = window.confirm(`Are you sure you want to remove '${source.name}'?`);
    if (!confirmed) return;
    const res = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    }
  }

  const grouped = sources.reduce<Record<string, Source[]>>((acc, s) => { const cat = s.category ?? "other"; if (!acc[cat]) acc[cat] = []; acc[cat].push(s); return acc; }, {});

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-12">
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
      <h1 className="text-5xl font-bold tracking-[-0.03em]">Sources</h1>
      <p className="mt-4 max-w-4xl text-2xl leading-relaxed text-white/70">Add direct RSS feeds, publication URLs, or author pages.</p>
      <form onSubmit={handleAdd} className="mt-8 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <p className="metadata-caps mb-2 text-white/70">Source name</p>
          <input ref={urlRef} type="text" placeholder="The Paris Review" value={nameInput} onChange={(e)=>setNameInput(e.target.value)} className="h-14 w-full border border-white/20 bg-transparent px-4 text-lg" />
        </div>
        <div>
          <p className="metadata-caps mb-2 text-white/70">URL or RSS</p>
          <input type="url" placeholder="https://" value={urlInput} onChange={(e)=>{setUrlInput(e.target.value); setDiscoverState("idle");}} className="h-14 w-full border border-white/20 bg-transparent px-4 text-lg" />
        </div>
        <button disabled={adding} className="touch-active mt-6 h-14 rounded-full bg-white px-8 text-lg font-medium text-black disabled:opacity-50">{adding ? "Adding…" : "Add Source"}</button>
      </form>
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={handleDiscover} className="text-sm text-white/70 underline">Find feed</button>
        {discoverState === "found" && <span className="text-sm text-green-400">Feed found</span>}
        {discoverState === "not-found" && <span className="text-sm text-amber-400">No feed found</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      {discoverState === "not-found" && <input type="url" value={feedUrlInput} onChange={(e)=>setFeedUrlInput(e.target.value)} placeholder="Manual feed URL" className="mt-2 h-12 w-full border border-white/20 bg-transparent px-4" />}
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        <div>
          <p className="metadata-caps mb-2 text-white/70">Choose category</p>
          <select value={categoryInput} onChange={(e)=>setCategoryInput(e.target.value)} className="h-10 w-full rounded-full border border-white/20 bg-transparent px-4 text-sm">{categories.map(c=><option key={c} value={c} className="bg-black">{c}</option>)}</select>
        </div>
        <div>
          <p className="metadata-caps mb-2 text-white/70">Or create new category</p>
          <input list="categories" value={newCategoryInput} onChange={(e) => setNewCategoryInput(e.target.value)} placeholder="e.g. politics" className="h-10 w-full rounded-full border border-white/20 bg-transparent px-4 text-sm" />
          <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
    </section>
    <div className="mt-8 grid gap-6 md:grid-cols-2">{Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([cat,items])=><section key={cat} className="rounded-3xl border border-white/10 bg-black/40 overflow-hidden"><div className="border-b border-white/10 p-5"><h2 className="text-4xl font-semibold capitalize tracking-[-0.02em]">{cat}</h2></div><ul className="divide-y divide-white/10">{items.map(source=><li key={source.id} className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="text-2xl leading-tight">{source.name}</p><p className="text-white/50">{source.url}</p></div><button onClick={()=>handleToggle(source)} className={`h-8 w-14 rounded-full border ${source.active?"bg-white border-white":"border-white/20"}`}><span className={`block h-6 w-6 rounded-full bg-black transition-transform ${source.active?"translate-x-6":"translate-x-1"}`} /></button><select value={source.category ?? "other"} onChange={(e)=>handleCategoryChange(source, e.target.value)} className="h-8 rounded-full border border-white/20 bg-transparent px-3 text-xs">{categories.map(c=><option key={c} value={c} className="bg-black">{c}</option>)}</select><button onClick={() => handleDelete(source)} className="rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10">Remove</button></li>)}</ul></section>)}</div>
    {loading && <p className="mt-6 text-white/50">Loading…</p>}
    {!loading && !sources.length && <p className="mt-6 text-white/50">No sources yet.</p>}
  </div>;
}
