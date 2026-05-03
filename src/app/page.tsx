import { db } from "@/db";
import { editions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getOrGenerateToday } from "./api/edition/today/route";
import FeedCards from "./feed-cards";
import FeedLoader from "./feed-loader";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  // Check whether there is already an edition for today without generating one
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let showFeedLoader = true;
  let editionData: Awaited<ReturnType<typeof getOrGenerateToday>> | null = null;

  try {
    const [latest] = await db
      .select()
      .from(editions)
      .orderBy(desc(editions.created_at))
      .limit(1);

    if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
      editionData = await getOrGenerateToday();
      showFeedLoader = false;
    }
  } catch {
    // DB unavailable or no edition yet — FeedLoader handles it
  }

  if (showFeedLoader || !editionData) {
    // No edition for today: load and generate client-side
    return <FeedLoader />;
  }

  return <FeedCards items={editionData.items} createdAt={editionData.created_at} />;
}
