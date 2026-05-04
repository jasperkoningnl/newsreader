import { db } from "@/db";
import { sources } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const unauthorized = requireApiToken(req);
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
  const unauthorized = requireApiToken(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json();
    const { url, name, feed_url, category } = body;

    if (!url || !name) {
      return NextResponse.json({ error: "url and name are required" }, { status: 400 });
    }

    const [created] = await db
      .insert(sources)
      .values({ url, name, feed_url: feed_url ?? null, category: category ?? null })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/sources:", error);
    return NextResponse.json({ error: "Failed to create source" }, { status: 500 });
  }
}
