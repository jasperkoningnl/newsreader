import { fetchAllFeeds } from "@/lib/fetch-feeds";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await fetchAllFeeds();
    return NextResponse.json({ results });
  } catch (error) {
    console.error("POST /api/fetch-feeds:", error);
    return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
  }
}
