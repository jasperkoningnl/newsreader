import { db } from "@/db";
import { taste_entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.delete(taste_entries).where(eq(taste_entries.id, parseInt(id, 10)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/taste/[id]:", error);
    return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
  }
}
