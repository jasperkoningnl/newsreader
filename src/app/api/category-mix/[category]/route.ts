import { db } from "@/db";
import { category_mix } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { EDITION_SIZE, fetchCategoryMix, normalizeCategory } from "@/lib/category-mix";

async function knownCategory(params: Promise<{ category: string }>) {
  const category = normalizeCategory(decodeURIComponent((await params).category));
  const rows = await fetchCategoryMix();
  return { category, rows, known: rows.some((r) => r.category === category) };
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { category, rows, known } = await knownCategory(params);
    if (!known) return NextResponse.json({ error: "Unknown category" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { min, max } = (body ?? {}) as { min?: unknown; max?: unknown };
    const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= EDITION_SIZE;
    if (!valid(min) || !valid(max) || min > max) {
      return NextResponse.json({ error: `min and max must be integers from 0 to ${EDITION_SIZE}, min <= max` }, { status: 400 });
    }

    const otherMins = rows.filter((r) => r.category !== category).reduce((sum, r) => sum + r.min, 0);
    if (otherMins + min > EDITION_SIZE) {
      return NextResponse.json(
        { error: `The minimums add up to ${otherMins + min}, more than the ${EDITION_SIZE} items in an edition` },
        { status: 400 }
      );
    }

    await db
      .insert(category_mix)
      .values({ category, min, max })
      .onConflictDoUpdate({ target: category_mix.category, set: { min, max } });
    return NextResponse.json({ category, min, max, custom: true });
  } catch (error) {
    console.error("PUT /api/category-mix/[category]:", error);
    return NextResponse.json({ error: "Failed to update category mix" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const category = normalizeCategory(decodeURIComponent((await params).category));
    await db.delete(category_mix).where(eq(category_mix.category, category));
    return NextResponse.json({ category, custom: false });
  } catch (error) {
    console.error("DELETE /api/category-mix/[category]:", error);
    return NextResponse.json({ error: "Failed to reset category mix" }, { status: 500 });
  }
}
