import { ingestReddit } from "@/lib/ingest-reddit";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function hasCredentials(): boolean {
  return Boolean(process.env.REDDIT_USERNAME && process.env.REDDIT_FEED_TOKEN);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasCredentials()) {
    return NextResponse.json({ skipped: true, reason: "Reddit credentials not set" });
  }

  try {
    const result = await ingestReddit();
    console.log(
      `[cron/reddit] saved=${result.saved_seen} upvoted=${result.upvoted_seen} inserted=${result.inserted} skipped=${result.skipped}`,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/reddit]", error);
    const message = error instanceof Error ? error.message : "Failed to ingest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
