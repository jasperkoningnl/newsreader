import { NextRequest, NextResponse } from "next/server";

function hostFromHeader(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  return (forwardedHost ?? req.headers.get("host") ?? "").toLowerCase();
}

function configuredToken(): string | null {
  return process.env.ADMIN_API_TOKEN || process.env.CRON_SECRET || null;
}

function providedToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return apiKey.trim();
  return req.nextUrl.searchParams.get("secret");
}

export function requireInternalToken(req: NextRequest): NextResponse | null {
  const token = configuredToken();
  if (!token) return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  if (providedToken(req) !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function requireSameOrigin(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Origin header required" }, { status: 401 });

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

export function requireSameOriginOrInternalToken(req: NextRequest): NextResponse | null {
  const sameOrigin = requireSameOrigin(req);
  if (!sameOrigin) return null;
  return requireInternalToken(req);
}
