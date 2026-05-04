import { NextRequest, NextResponse } from "next/server";

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return apiKey.trim();
  return req.nextUrl.searchParams.get("secret");
}

export function requireApiToken(req: NextRequest): NextResponse | null {
  const token = process.env.ADMIN_API_TOKEN || process.env.CRON_SECRET;
  if (!token) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  if (extractToken(req) !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
