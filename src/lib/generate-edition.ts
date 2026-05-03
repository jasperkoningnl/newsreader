import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { articles, editions, sources } from "@/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

const client = new Anthropic();

type Candidate = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  category: string | null;
  published_at: string | null;
  source: string;
};

type CuratorItem = { id: number; motivatie: string };

async function runCurator(candidates: Candidate[], profile: string): Promise<CuratorItem[]> {
  const list = candidates
    .map(
      (a) =>
        `ID ${a.id} | bron: ${a.source} | categorie: ${a.category ?? "overig"} | ${a.title}\n  ${a.description?.slice(0, 200) ?? "(geen beschrijving)"}`
    )
    .join("\n\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Hier is Jasper's profiel en smaakvoorkeur:
${profile}

Selecteer precies 15 artikelen uit de onderstaande lijst die samen de beste dagelijkse feed vormen.

HARDE REGELS (verplicht, geen uitzonderingen):
- Maximaal 2 items van dezelfde bron (bijv. max 2 van "The Verge", max 2 van "TechCrunch")
- Maximaal 3 items uit dezelfde categorie
- Altijd minstens 1 Nederlandstalig item (bron: NOS Nieuws, NRC, of Follow the Money)
- Minstens 1 longread (schat in op basis van titel/beschrijving)
- Maximaal 2 breaking-news items; de rest moet een dag later nog leesbaar zijn
- 1 verrassingsitem buiten de verwachte interesses (serendipity)

GEWENSTE MIX:
- 2-3 tech/AI (waarvan max 1 van dezelfde tech-bron)
- 1-2 serie/film/streaming
- 1-2 nieuws of geopolitiek (analyse, geen breaking)
- 1 sport of games
- 1 wetenschap of cultuur
- 1 verrassing

Kandidaat-artikelen:
${list}

Antwoord uitsluitend als geldig JSON array (geen markdown, geen tekst erbuiten):
[{"id": <number>, "motivatie": "<één zin waarom dit item"}, ...]`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Curator gaf geen geldig JSON: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as CuratorItem[];
}

function enforceConstraints(selected: CuratorItem[], candidates: Candidate[]): CuratorItem[] {
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const sourceCounts: Record<string, number> = {};
  const result: CuratorItem[] = [];

  for (const item of selected) {
    const c = byId[item.id];
    if (!c) continue;
    if ((sourceCounts[c.source] ?? 0) >= 2) continue;
    sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
    result.push(item);
  }

  return result;
}

const MAX_PER_SOURCE = 3;
const EDITION_SIZE = 10;

export async function generateEdition(): Promise<{ edition_id: number; count: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  // Fetch all unread recent articles ordered newest-first, then cap per source so
  // no single high-volume source dominates the curator's input.
  const all = await db
    .select({
      id: articles.id,
      title: articles.title,
      description: articles.description,
      url: articles.url,
      category: articles.category,
      published_at: articles.published_at,
      source: sources.name,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .where(and(eq(articles.read, 0), gte(articles.fetched_at, threeDaysAgo)))
    .orderBy(desc(articles.fetched_at));

  const countPerSource: Record<string, number> = {};
  const candidates: Candidate[] = [];
  for (const a of all) {
    const n = countPerSource[a.source] ?? 0;
    if (n < MAX_PER_SOURCE) {
      candidates.push(a);
      countPerSource[a.source] = n + 1;
    }
  }
  // Shuffle so the curator doesn't see sources in alphabetical/fetch order.
  candidates.sort(() => Math.random() - 0.5);

  if (candidates.length < 5) {
    throw new Error("Te weinig kandidaat-artikelen (< 5). Haal eerst feeds op.");
  }

  const uniqueSources = new Set(candidates.map((c) => c.source));
  console.log(`Curator: ${candidates.length} kandidaten van ${uniqueSources.size} bronnen:`, [...uniqueSources].join(", "));

  const profile = readFileSync(join(process.cwd(), "profile.md"), "utf-8");
  const raw = await runCurator(candidates, profile);
  const selected = enforceConstraints(raw, candidates).slice(0, EDITION_SIZE);

  if (!selected.length) throw new Error("Curator selecteerde geen artikelen na constraints");

  const itemsJson = JSON.stringify(selected);
  const [edition] = await db.insert(editions).values({ items_json: itemsJson }).returning();

  await db
    .update(articles)
    .set({ read: 1 })
    .where(inArray(articles.id, selected.map((s) => s.id)));

  return { edition_id: edition.id, count: selected.length };
}
