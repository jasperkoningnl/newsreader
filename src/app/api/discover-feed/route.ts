import { discoverFeedUrl } from "@/lib/feed-discovery";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { isRateLimited } from "@/lib/rate-limit";
import { assertSafePublicUrl } from "@/lib/net-safety";

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  if (isRateLimited(req, "discover-feed", 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { url } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const safeUrl = await assertSafePublicUrl(url);
    const feedUrl = await discoverFeedUrl(safeUrl.toString());
    return NextResponse.json({ feedUrl });
  } catch {
    return NextResponse.json({ error: "Discovery failed" }, { status: 500 });
  }
}
