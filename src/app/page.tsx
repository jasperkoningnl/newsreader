import { db } from "@/db";
import { editions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getOrGenerateToday } from "./api/edition/today/route";
import FeedCards from "./feed-cards";
import FeedLoader from "./feed-loader";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  // Check of er al een editie van vandaag is zonder die te genereren
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const [latest] = await db
      .select()
      .from(editions)
      .orderBy(desc(editions.created_at))
      .limit(1);

    if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
      const edition = await getOrGenerateToday();
      return <FeedCards items={edition.items} createdAt={edition.created_at} />;
    }
  } catch {
    // DB niet bereikbaar of geen editie — FeedLoader handelt het af
  }

  // Geen editie van vandaag: client-side laden + genereren
  return <FeedLoader />;
}
