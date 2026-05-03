import { db } from "@/db";
import { taste_entries } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const all = await db.select().from(taste_entries).orderBy(desc(taste_entries.added_at));
    return NextResponse.json(all);
  } catch (error) {
    console.error("GET /api/taste:", error);
    return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, type, liked, notes } = body;

    if (!title || !type) {
      return NextResponse.json({ error: "title en type zijn verplicht" }, { status: 400 });
    }

    const [created] = await db
      .insert(taste_entries)
      .values({
        title: String(title).trim(),
        type: String(type),
        liked: liked === false || liked === 0 ? 0 : 1,
        notes: notes ? String(notes).trim() : null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/taste:", error);
    return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
  }
}
