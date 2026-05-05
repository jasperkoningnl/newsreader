import { config } from "dotenv";
config({ path: ".env.local" });

import { ingestReddit } from "@/lib/ingest-reddit";

async function main(): Promise<void> {
  const result = await ingestReddit();
  console.log(
    `[ingest-reddit] saved=${result.saved_seen} upvoted=${result.upvoted_seen} inserted=${result.inserted} skipped=${result.skipped}`,
  );
}

main().catch((error) => {
  console.error("[ingest-reddit]", error);
  process.exit(1);
});
