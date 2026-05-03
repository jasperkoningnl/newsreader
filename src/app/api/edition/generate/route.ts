import { generateEdition } from "@/lib/generate-edition";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST() {
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
