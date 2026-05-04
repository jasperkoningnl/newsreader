import { NextRequest, NextResponse } from "next/server";

function hostFromHeader(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  return (forwardedHost ?? req.headers.get("host") ?? "").toLowerCase();
}

export function requireSameOrigin(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const origin = req.headers.get("origin");
  if (!origin) return null; // allow non-browser clients and same-origin navigations

  const requestHost = hostFromHeader(req);
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (originHost !== requestHost) {
      return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 400 });
  }

  return null;
}
