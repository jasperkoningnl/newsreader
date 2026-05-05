import { db } from "@/db";
import { sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { assertSafePublicUrl } from "@/lib/net-safety";

function canonicalize(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname === "") u.pathname = "/";
  return u.toString();
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const sourceId = parseInt(id, 10);
    if (isNaN(sourceId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json();
    const { name, url, feed_url, category, active, is_paywall } = body;

    const updateData: Partial<typeof sources.$inferInsert> = {};
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (active !== undefined) updateData.active = active ? 1 : 0;
    if (is_paywall !== undefined) updateData.is_paywall = is_paywall ? 1 : 0;

    try {
      if (typeof url === "string" && url.length > 0) {
        await assertSafePublicUrl(url);
        updateData.url = canonicalize(url);
      }
      if (typeof feed_url === "string" && feed_url.length > 0) {
        await assertSafePublicUrl(feed_url);
        updateData.feed_url = canonicalize(feed_url);
      } else if (feed_url === null) {
        updateData.feed_url = null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const [updated] = await db
      .update(sources)
      .set(updateData)
      .where(eq(sources.id, sourceId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PUT /api/sources/[id]:", error);
    return NextResponse.json({ error: "Failed to update source" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const sourceId = parseInt(id, 10);
    if (isNaN(sourceId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(sources)
      .where(eq(sources.id, sourceId))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/sources/[id]:", error);
    return NextResponse.json({ error: "Failed to delete source" }, { status: 500 });
  }
}
