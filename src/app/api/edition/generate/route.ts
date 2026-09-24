import { generateTodaysEdition } from "@/lib/generate-sunday";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOriginOrInternalToken } from "@/lib/api-auth";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const unauthorized = requireSameOriginOrInternalToken(req);
  if (unauthorized) return unauthorized;
  try {
    const result = await generateTodaysEdition();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/edition/generate:", error);
    const message = error instanceof Error ? error.message : "Failed to generate";
    const status = message.includes("Te weinig") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
