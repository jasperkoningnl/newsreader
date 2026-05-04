import { discoverFeedUrl } from "@/lib/feed-discovery";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOrigin(req);
  if (unauthorized) return unauthorized;
  const { url } = await req.json();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const feedUrl = await discoverFeedUrl(url);
    return NextResponse.json({ feedUrl });
  } catch {
    return NextResponse.json({ error: "Discovery failed" }, { status: 500 });
  }
}
