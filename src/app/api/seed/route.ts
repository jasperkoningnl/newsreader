import { db } from "@/db";
import { sources } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";

const SEED_SOURCES = [
  // Tech
  { name: "The Verge", url: "https://www.theverge.com", feed_url: "https://www.theverge.com/rss/index.xml", category: "tech" },
  { name: "TechCrunch", url: "https://techcrunch.com", feed_url: "https://techcrunch.com/feed/", category: "tech" },
  { name: "Ars Technica", url: "https://arstechnica.com", feed_url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com", feed_url: "https://www.technologyreview.com/feed/", category: "tech" },
  { name: "Engadget", url: "https://www.engadget.com", feed_url: "https://www.engadget.com/rss.xml", category: "tech" },
  { name: "The Next Web", url: "https://thenextweb.com", feed_url: "https://thenextweb.com/feed/", category: "tech" },
  { name: "Wired", url: "https://www.wired.com", feed_url: "https://www.wired.com/feed/rss", category: "tech" },
  // Nieuws internationaal
  { name: "The Guardian", url: "https://www.theguardian.com", feed_url: "https://www.theguardian.com/world/rss", category: "nieuws" },
  { name: "BBC News", url: "https://www.bbc.com/news", feed_url: "https://feeds.bbci.co.uk/news/rss.xml", category: "nieuws" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com", feed_url: "https://www.aljazeera.com/xml/rss/all.xml", category: "nieuws" },
  { name: "ProPublica", url: "https://www.propublica.org", feed_url: "https://feeds.propublica.org/propublica/main", category: "nieuws" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com", feed_url: "https://foreignpolicy.com/feed/", category: "nieuws" },
  { name: "The Atlantic", url: "https://www.theatlantic.com", feed_url: "https://www.theatlantic.com/feed/all/", category: "nieuws" },
  { name: "Vox", url: "https://www.vox.com", feed_url: "https://www.vox.com/rss/index.xml", category: "nieuws" },
  // Nieuws NL
  { name: "NOS Nieuws", url: "https://nos.nl", feed_url: "https://feeds.nos.nl/nosnieuwsalgemeen", category: "nieuws" },
  { name: "NRC", url: "https://www.nrc.nl", feed_url: "https://www.nrc.nl/rss/", category: "nieuws" },
  { name: "Follow the Money", url: "https://www.ftm.nl", feed_url: "https://www.ftm.nl/rss", category: "nieuws" },
  // Series / cultuur
  { name: "Vulture", url: "https://www.vulture.com", feed_url: "https://www.vulture.com/rss/all.xml", category: "series" },
  { name: "The A.V. Club", url: "https://www.avclub.com", feed_url: "https://www.avclub.com/feeds/ucp.rss", category: "series" },
  { name: "Den of Geek", url: "https://www.denofgeek.com", feed_url: "https://www.denofgeek.com/feed/", category: "series" },
  { name: "Variety", url: "https://variety.com", feed_url: "https://variety.com/feed/", category: "series" },
  { name: "Deadline", url: "https://deadline.com", feed_url: "https://deadline.com/feed/", category: "series" },
  // Games
  { name: "Polygon", url: "https://www.polygon.com", feed_url: "https://www.polygon.com/rss/index.xml", category: "games" },
  { name: "IGN", url: "https://www.ign.com", feed_url: "https://feeds.ign.com/ign/all", category: "games" },
  { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com", feed_url: "https://www.rockpapershotgun.com/feed/", category: "games" },
  { name: "Eurogamer", url: "https://www.eurogamer.net", feed_url: "https://www.eurogamer.net/feed", category: "games" },
  // Wetenschap
  { name: "New Scientist", url: "https://www.newscientist.com", feed_url: "https://www.newscientist.com/feed/home/", category: "wetenschap" },
  { name: "Scientific American", url: "https://www.scientificamerican.com", feed_url: "https://rss.sciam.com/ScientificAmerican-Global", category: "wetenschap" },
  { name: "Popular Science", url: "https://www.popsci.com", feed_url: "https://www.popsci.com/feed/", category: "wetenschap" },
  // Cultuur / overig
  { name: "Rolling Stone", url: "https://www.rollingstone.com", feed_url: "https://www.rollingstone.com/feed/", category: "cultuur" },
  { name: "Lifehacker", url: "https://lifehacker.com", feed_url: "https://lifehacker.com/feed/rss", category: "overig" },
  { name: "Kottke", url: "https://kottke.org", feed_url: "https://feeds.kottke.org/main", category: "overig" },
];

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let inserted = 0;
    let updated = 0;

    for (const source of SEED_SOURCES) {
      const result = await db
        .insert(sources)
        .values(source)
        .onConflictDoUpdate({
          target: sources.url,
          set: { feed_url: source.feed_url, name: source.name, category: source.category },
        });
      if (result.rowsAffected > 0) inserted++;
      else updated++;
    }

    return NextResponse.json({
      ok: true,
      inserted,
      updated,
      total: SEED_SOURCES.length,
    });
  } catch (error) {
    console.error("GET /api/seed:", error);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
