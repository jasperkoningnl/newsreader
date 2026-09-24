import { db } from "@/db";
import { category_mix, sources } from "@/db/schema";
import { eq } from "drizzle-orm";

export const EDITION_SIZE = 10;

export type MixRow = {
  category: string;
  min: number;
  max: number;
  default_min: number;
  default_max: number;
  custom: boolean;
};

const DEFAULTS: Record<string, [number, number]> = {
  tech: [2, 3],
  series: [1, 2],
  news: [1, 2],
  nieuws: [1, 2],
  local: [1, 2],
  sports: [0, 1],
  sport: [0, 1],
  games: [0, 1],
  science: [0, 1],
  wetenschap: [0, 1],
  culture: [0, 1],
  cultuur: [0, 1],
};
const OTHER_DEFAULT: [number, number] = [0, 2];

export const LOCAL_CATEGORY = "local";
export const OTHER_CATEGORY = "other";

// Sources created by the Reddit/Bluesky promotion have no category; older seed data used "overig".
export function normalizeCategory(raw: string | null | undefined): string {
  const category = (raw ?? "").toLowerCase().trim();
  return !category || category === "overig" ? OTHER_CATEGORY : category;
}

export function defaultMix(category: string): [number, number] {
  return DEFAULTS[category] ?? OTHER_DEFAULT;
}

export async function fetchCategoryMix(): Promise<MixRow[]> {
  const [active, custom] = await Promise.all([
    db.selectDistinct({ category: sources.category }).from(sources).where(eq(sources.active, 1)),
    db.select().from(category_mix),
  ]);
  const customByCat = new Map(custom.map((r) => [r.category, r]));
  const categories = new Set([...active.map((r) => normalizeCategory(r.category)), ...customByCat.keys()]);

  return [...categories]
    .map((category) => {
      const [default_min, default_max] = defaultMix(category);
      const row = customByCat.get(category);
      return {
        category,
        min: row?.min ?? default_min,
        max: row?.max ?? default_max,
        default_min,
        default_max,
        custom: !!row,
      };
    })
    .sort((a, b) => b.min - a.min || b.max - a.max || a.category.localeCompare(b.category));
}

export function mixLookup(rows: MixRow[]): (category: string) => { min: number; max: number } {
  const byCat = new Map(rows.map((r) => [r.category, r]));
  return (category) => {
    const row = byCat.get(category);
    if (row) return row;
    const [min, max] = defaultMix(category);
    return { min, max };
  };
}
