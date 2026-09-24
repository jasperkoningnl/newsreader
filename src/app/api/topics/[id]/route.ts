import { db } from "@/db";
import { topics } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const topicId = parseInt(id, 10);
    if (!Number.isInteger(topicId) || topicId <= 0) {
      return NextResponse.json({ error: "Invalid topic id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const weight: unknown = body?.weight;
    if (weight !== null && !(Number.isInteger(weight) && (weight as number) >= -2 && (weight as number) <= 2)) {
      return NextResponse.json({ error: "weight must be an integer from -2 to 2, or null for automatic" }, { status: 400 });
    }

    const [updated] = await db
      .update(topics)
      .set({ manual_weight: weight as number | null })
      .where(eq(topics.id, topicId))
      .returning();
    if (!updated) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PUT /api/topics/[id]:", error);
    return NextResponse.json({ error: "Failed to update topic" }, { status: 500 });
  }
}
