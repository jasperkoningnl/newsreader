import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { articles, editions, sources } from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

const client = new Anthropic();

type CuratorItem = { id: number; motivatie: string };

async function runCurator(
  candidates: { id: number; title: string; description: string | null; source: string; category: string | null }[],
  profile: string
): Promise<CuratorItem[]> {
  const list = candidates
    .map(
      (a) =>
        `ID ${a.id} | ${a.source} | ${a.category ?? "overig"} | ${a.title}\n  ${a.description?.slice(0, 200) ?? "(geen beschrijving)"}`
    )
    .join("\n\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Hier is Jasper's profiel en smaakvoorkeur:
${profile}

Selecteer precies 10 artikelen uit de onderstaande lijst die samen de beste dagelijkse feed vormen.

Regels:
- Nooit meer dan 3 items uit dezelfde categorie
- Altijd minstens 1 Nederlandstalig item (NOS, NRC, FTM)
- Minstens 1 longread (schat in op basis van titel/beschrijving)
- Maximaal 2 breaking-news items; de rest moet een dag later nog leesbaar zijn
- 1 verrassingsitem buiten de verwachte interesses (serendipity)
- Viral longreads en non-fictie boekentips zijn altijd welkom
- Gewenste mix: 2-3 tech/AI, 1-2 serie/film, 1-2 nieuws/geopolitiek, 1 sport of games, 1 wetenschap/cultuur, 1 verrassing

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

export async function generateEdition(): Promise<{ edition_id: number; count: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const candidates = await db
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
    .limit(60);

  if (candidates.length < 5) {
    throw new Error("Te weinig kandidaat-artikelen (< 5). Haal eerst feeds op.");
  }

  const profile = readFileSync(join(process.cwd(), "profile.md"), "utf-8");
  const selected = await runCurator(candidates, profile);
  if (!selected.length) throw new Error("Curator selecteerde geen artikelen");

  const itemsJson = JSON.stringify(selected);
  const [edition] = await db.insert(editions).values({ items_json: itemsJson }).returning();

  await db
    .update(articles)
    .set({ read: 1 })
    .where(inArray(articles.id, selected.map((s) => s.id)));

  return { edition_id: edition.id, count: selected.length };
}
