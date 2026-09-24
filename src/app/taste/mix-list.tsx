"use client";

import { useRef, useState } from "react";
import type { MixRow } from "@/lib/category-mix";

const EDITION_SIZE = 10;

function Stepper({ label, value, onChange, canDown, canUp }: { label: string; value: number; onChange: (n: number) => void; canDown: boolean; canUp: boolean }) {
  const btn = "touch-active h-9 w-9 rounded-full border border-white/25 text-lg leading-none disabled:opacity-25";
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[11px] uppercase tracking-[0.1em] text-white/45">{label}</span>
      <button type="button" className={btn} disabled={!canDown} onClick={() => onChange(value - 1)} aria-label={`Lower ${label}`}>−</button>
      <span className="w-5 text-center text-lg tabular-nums">{value}</span>
      <button type="button" className={btn} disabled={!canUp} onClick={() => onChange(value + 1)} aria-label={`Raise ${label}`}>+</button>
    </div>
  );
}

export default function MixList({ initial }: { initial: MixRow[] }) {
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const totalMin = rows.reduce((sum, r) => sum + r.min, 0);
  const totalMax = rows.reduce((sum, r) => sum + r.max, 0);

  function save(category: string, body: { min: number; max: number } | null) {
    clearTimeout(timers.current[category]);
    timers.current[category] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/category-mix/${encodeURIComponent(category)}`, {
          method: body ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        setErrors((e) => ({ ...e, [category]: res.ok ? "" : data.error ?? "Could not save" }));
      } catch {
        setErrors((e) => ({ ...e, [category]: "Could not save" }));
      }
    }, 400);
  }

  function update(category: string, min: number, max: number) {
    setRows((prev) => prev.map((r) => (r.category === category ? { ...r, min, max, custom: true } : r)));
    save(category, { min, max });
  }

  function reset(row: MixRow) {
    setRows((prev) => prev.map((r) => (r.category === row.category ? { ...r, min: r.default_min, max: r.default_max, custom: false } : r)));
    save(row.category, null);
  }

  return (
    <>
      <p className="mt-2 text-sm text-white/50">
        Minimums add up to {totalMin} of {EDITION_SIZE}.
        {totalMax < EDITION_SIZE && ` The maximums only add up to ${totalMax}, so some days a category goes over its max to fill the edition.`}
      </p>
      <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
        {rows.map((r) => (
          <li key={r.category} className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h3 className="text-xl font-semibold capitalize">{r.category}</h3>
              {r.custom ? (
                <button type="button" onClick={() => reset(r)} className="mt-1 text-sm text-white/60 underline underline-offset-4 hover:text-white">
                  Back to default ({r.default_min}–{r.default_max})
                </button>
              ) : (
                <p className="mt-1 text-sm text-white/40">Default</p>
              )}
              {errors[r.category] && <p className="mt-1 text-sm text-red-400">{errors[r.category]}</p>}
            </div>
            <div className="flex gap-6">
              <Stepper
                label="Min"
                value={r.min}
                canDown={r.min > 0}
                canUp={totalMin < EDITION_SIZE}
                onChange={(min) => update(r.category, min, Math.max(min, r.max))}
              />
              <Stepper
                label="Max"
                value={r.max}
                canDown={r.max > 0}
                canUp={r.max < EDITION_SIZE}
                onChange={(max) => update(r.category, Math.min(r.min, max), max)}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
