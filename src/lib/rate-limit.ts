import { NextRequest } from "next/server";

type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

function clientKey(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return ip;
}

export function isRateLimited(req: NextRequest, scope: string, limit: number, windowMs: number): boolean {
  const key = `${scope}:${clientKey(req)}`;
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (current.count >= limit) return true;
  current.count += 1;
  return false;
}
