import { db } from "@/db";
import { sources } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { assertSafePublicUrl } from "@/lib/net-safety";

function canonicalize(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname === "") u.pathname = "/";
  return u.toString();
}

export async function GET(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const all = await db.select().from(sources).orderBy(sources.category, sources.name);
    return NextResponse.json(all);
  } catch (error) {
    console.error("GET /api/sources:", error);
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json();
    const { url, name, feed_url, category } = body;

    if (!url || !name || typeof url !== "string" || typeof name !== "string") {
      return NextResponse.json({ error: "url and name are required" }, { status: 400 });
    }

    let safeUrl: string;
    let safeFeedUrl: string | null = null;
    try {
      await assertSafePublicUrl(url);
      safeUrl = canonicalize(url);
      if (feed_url) {
        if (typeof feed_url !== "string") {
          return NextResponse.json({ error: "feed_url must be a string" }, { status: 400 });
        }
        await assertSafePublicUrl(feed_url);
        safeFeedUrl = canonicalize(feed_url);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid URL";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const [created] = await db
      .insert(sources)
      .values({ url: safeUrl, name, feed_url: safeFeedUrl, category: category ?? null })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/sources:", error);
    return NextResponse.json({ error: "Failed to create source" }, { status: 500 });
  }
}
