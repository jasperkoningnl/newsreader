import { db } from "@/db";
import { editions } from "@/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import {
  getOrGenerateToday,
  getEditionByDate,
  listEditionDates,
} from "./api/edition/today/route";
import FeedCards from "./feed-cards";
import FeedLoader from "./feed-loader";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function neighbours(dates: string[], activeDate: string) {
  const idx = dates.indexOf(activeDate);
  if (idx === -1) {
    const older = dates.find((d) => d < activeDate) ?? null;
    return { newerDate: null, olderDate: older };
  }
  return {
    newerDate: idx > 0 ? dates[idx - 1] : null,
    olderDate: idx < dates.length - 1 ? dates[idx + 1] : null,
  };
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const dates = await listEditionDates(30).catch(() => [] as string[]);

  if (date && DATE_RE.test(date)) {
    const archived = await getEditionByDate(date).catch(() => null);
    const { newerDate, olderDate } = neighbours(dates, date);
    if (!archived) {
      return (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="mb-6 text-5xl">📰</div>
          <h2 className="mb-2 text-2xl font-bold">No edition for this day</h2>
          <p className="text-sm text-white/40">{date}</p>
          <Link
            href="/"
            className="mt-6 rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
          >
            Back to today
          </Link>
        </div>
      );
    }
    return (
      <FeedCards
        items={archived.items}
        createdAt={archived.created_at}
        archived
        olderDate={olderDate}
        newerDate={newerDate}
      />
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let editionData: Awaited<ReturnType<typeof getOrGenerateToday>> | null = null;
  try {
    const [latest] = await db
      .select()
      .from(editions)
      .orderBy(desc(editions.created_at))
      .limit(1);

    if (latest && new Date(latest.created_at ?? 0) >= todayStart) {
      editionData = await getOrGenerateToday();
    }
  } catch {
    // DB unavailable or no edition yet — FeedLoader handles it
  }

  if (!editionData) {
    return <FeedLoader />;
  }

  const activeDate = (editionData.created_at ?? "").slice(0, 10);
  const { olderDate } = neighbours(dates, activeDate);
  return (
    <FeedCards
      items={editionData.items}
      createdAt={editionData.created_at}
      olderDate={olderDate}
    />
  );
}
