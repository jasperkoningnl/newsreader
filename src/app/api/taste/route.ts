import { db } from "@/db";
import { taste_entries } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/api-auth";

const ALLOWED_TYPES = ["series", "film", "boek", "game", "muziek"] as const;
type CanonicalType = (typeof ALLOWED_TYPES)[number];

function normalizeType(raw: unknown): CanonicalType {
  const value = String(raw ?? "").toLowerCase().trim();
  if (value === "serie") return "series";
  if (value === "spel") return "game";
  if (value === "podcast") return "muziek";
  if ((ALLOWED_TYPES as readonly string[]).includes(value)) return value as CanonicalType;
  return "film";
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiToken(req);
  if (unauthorized) return unauthorized;
  try {
    const all = await db.select().from(taste_entries).orderBy(desc(taste_entries.added_at));
    const migrated = await Promise.all(
      all.map(async (entry) => {
        const normalized = normalizeType(entry.type);
        if (normalized !== entry.type) {
          await db
            .update(taste_entries)
            .set({ type: normalized })
            .where(eq(taste_entries.id, entry.id));
          return { ...entry, type: normalized };
        }
        return entry;
      })
    );
    return NextResponse.json(migrated);
  } catch (error) {
    console.error("GET /api/taste:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireApiToken(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json();
    const { title, type, liked, notes, rating } = body;

    if (!title || !type) {
      return NextResponse.json({ error: "title and type are required" }, { status: 400 });
    }
    const parsedRating = rating === null || rating === undefined ? null : Number(rating);
    if (parsedRating !== null && (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 10)) {
      return NextResponse.json({ error: "rating must be an integer between 1 and 10" }, { status: 400 });
    }

    const [created] = await db
      .insert(taste_entries)
      .values({
        title: String(title).trim(),
        type: normalizeType(type),
        rating: parsedRating,
        liked: liked === false || liked === 0 ? 0 : 1,
        notes: notes ? String(notes).trim() : null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/taste:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
