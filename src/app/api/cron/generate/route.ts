import { generateEdition } from "@/lib/generate-edition";
import { db } from "@/db";
import { editions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [latest] = await db
      .select()
      .from(editions)
      .orderBy(desc(editions.created_at))
      .limit(1);

    if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
      console.log(`[cron/generate] skipped: editie ${latest.id} bestaat al voor vandaag`);
      return NextResponse.json({ skipped: true, edition_id: latest.id });
    }

    const result = await generateEdition();
    console.log(`[cron/generate] Editie ${result.edition_id} gegenereerd met ${result.count} items`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/generate]", error);
    const message = error instanceof Error ? error.message : "Failed to generate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
