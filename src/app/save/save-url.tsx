"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type State =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; articleId: number; title: string }
  | { status: "error"; message: string };

export default function SaveUrl({
  initialUrl,
  initialText,
  initialTitle,
}: {
  initialUrl: string | null;
  initialText: string | null;
  initialTitle: string | null;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [input, setInput] = useState(initialUrl ?? "");
  const autoSaved = useRef(false);

  async function save(payload: { url?: string | null; text?: string | null; title?: string | null }) {
    setState({ status: "saving" });
    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: "error", message: data?.error ?? "Saving failed" });
        return;
      }
      setState({ status: "saved", articleId: data.article_id, title: data.title });
      setInput("");
    } catch {
      setState({ status: "error", message: "Network error" });
    }
  }

  useEffect(() => {
    if (autoSaved.current || (!initialUrl && !initialText)) return;
    autoSaved.current = true;
    void save({ url: initialUrl, text: initialText, title: initialTitle });
  }, [initialUrl, initialText, initialTitle]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (input.trim()) void save({ url: input.trim() });
  }

  return (
    <div className="mt-8 space-y-8">
      {state.status === "saving" && <p className="text-xl text-white/70">Saving…</p>}
      {state.status === "error" && <p className="text-xl text-red-300">{state.message}</p>}
      {state.status === "saved" && (
        <div className="space-y-4">
          <p className="metadata-caps text-white/55">Saved</p>
          <p className="text-3xl font-semibold leading-tight tracking-[-0.02em]">{state.title}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/article/${state.articleId}?from=/saved`} className="touch-active rounded-full bg-white px-6 py-3 text-sm font-medium text-black">
              Read now
            </Link>
            <Link href="/saved" className="touch-active rounded-full border border-white/25 px-6 py-3 text-sm text-white/85 hover:bg-white/10">
              All saved
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3 md:flex-row">
        <input
          type="url"
          inputMode="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://…"
          className="h-14 min-w-0 flex-1 border-b border-white/30 bg-transparent text-xl outline-none placeholder:text-white/30 focus:border-white"
        />
        <button
          disabled={state.status === "saving" || !input.trim()}
          className="touch-active h-14 rounded-full bg-white px-8 text-lg font-medium text-black disabled:opacity-50"
        >
          Save link
        </button>
      </form>
    </div>
  );
}
