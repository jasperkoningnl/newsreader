import { db } from "@/db";
import { taste_entries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requireApiToken } from "@/lib/api-auth";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiToken(_req);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    await db.delete(taste_entries).where(eq(taste_entries.id, parseInt(id, 10)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/taste/[id]:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
