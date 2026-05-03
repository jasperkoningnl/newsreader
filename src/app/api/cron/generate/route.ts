import { generateEdition } from "@/lib/generate-edition";
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

  try {
    const result = await generateEdition();
    console.log(`[cron/generate] Editie ${result.edition_id} gegenereerd met ${result.count} items`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/generate]", error);
    const message = error instanceof Error ? error.message : "Genereren mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
