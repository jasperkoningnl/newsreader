import { ingestBluesky } from "@/lib/ingest-bluesky";
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

  if (!process.env.BSKY_HANDLE || !process.env.BSKY_APP_PASSWORD) {
    return NextResponse.json({ skipped: true, reason: "BSKY credentials not set" });
  }

  try {
    const result = await ingestBluesky();
    console.log(
      `[cron/bluesky] likes=${result.likes_seen} timeline=${result.timeline_seen} inserted=${result.inserted} skipped=${result.skipped}`,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/bluesky]", error);
    const message = error instanceof Error ? error.message : "Failed to ingest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
