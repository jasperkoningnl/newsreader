import { generateEdition } from "@/lib/generate-edition";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await generateEdition();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/edition/generate:", error);
    const message = error instanceof Error ? error.message : "Genereren mislukt";
    const status = message.includes("Te weinig") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
