import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { articles, editions, sources, taste_entries } from "@/db/schema";
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

const NL_SOURCES = new Set(["NOS Nieuws", "NRC", "Follow the Money"]);
const BREAKING_WORDS = ["breaking", "live", "zojuist", "net binnen", "urgent", "ontwikkelt", "update"];
const LONGREAD_WORDS = ["analyse", "essay", "longread", "interview", "achtergrond", "dossier"];
const EXPECTED_CATEGORIES = new Set(["tech", "nieuws", "series", "sport", "games", "wetenschap", "cultuur"]);

async function fetchTasteContext(): Promise<string> {
  const recent = await db
    .select()
    .from(taste_entries)
    .orderBy(desc(taste_entries.added_at))
    .limit(30);

  if (!recent.length) return "";

  const lines = recent.map(
    (e) =>
      `${e.liked ? "✓" : "✗"} [${e.type}] ${e.title}${e.notes ? ` — ${e.notes}` : ""}`
  );
  return `\nRecent bekeken/gelezen/gespeeld door Jasper (gebruik als extra signaal voor zijn smaak):\n${lines.join("\n")}\n`;
}

async function runCurator(candidates: Candidate[], profile: string, tasteContext: string): Promise<CuratorItem[]> {
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
${profile}${tasteContext}

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

function textBlob(item: Candidate): string {
  return `${item.title} ${item.description ?? ""}`.toLowerCase();
}

function isBreaking(item: Candidate): boolean {
  const t = textBlob(item);
  return BREAKING_WORDS.some((w) => t.includes(w));
}

function isLongread(item: Candidate): boolean {
  const t = textBlob(item);
  if (LONGREAD_WORDS.some((w) => t.includes(w))) return true;
  return (item.description?.length ?? 0) > 220;
}

function isSurprise(item: Candidate): boolean {
  const cat = (item.category ?? "overig").toLowerCase();
  return !EXPECTED_CATEGORIES.has(cat);
}

function meetsGlobalRules(items: Candidate[]): boolean {
  const hasNl = items.some((i) => NL_SOURCES.has(i.source));
  const hasLongread = items.some(isLongread);
  const breakingCount = items.filter(isBreaking).length;
  const hasSurprise = items.some(isSurprise);
  return hasNl && hasLongread && breakingCount <= 2 && hasSurprise;
}

function enforceConstraints(selected: CuratorItem[], candidates: Candidate[]): CuratorItem[] {
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const curatedById = Object.fromEntries(selected.map((s) => [s.id, s]));

  const sourceCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const result: CuratorItem[] = [];

  const canAdd = (c: Candidate, current: Candidate[]) => {
    const sourceCount = sourceCounts[c.source] ?? 0;
    if (sourceCount >= 2) return false;
    const cat = (c.category ?? "overig").toLowerCase();
    const catCount = categoryCounts[cat] ?? 0;
    if (catCount >= 3) return false;
    const breakingCount = current.filter(isBreaking).length;
    if (isBreaking(c) && breakingCount >= 2) return false;
    return true;
  };

  const add = (c: Candidate) => {
    const cat = (c.category ?? "overig").toLowerCase();
    sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    result.push(curatedById[c.id] ?? { id: c.id, motivatie: "Toegevoegd om aan mixregels te voldoen." });
  };

  for (const item of selected) {
    const c = byId[item.id];
    if (!c) continue;
    const currentCandidates = result.map((r) => byId[r.id]).filter((x): x is Candidate => !!x);
    if (canAdd(c, currentCandidates)) add(c);
  }

  const available = candidates.filter((c) => !result.some((r) => r.id === c.id));
  for (const c of available) {
    if (result.length >= EDITION_SIZE) break;
    const currentCandidates = result.map((r) => byId[r.id]).filter((x): x is Candidate => !!x);
    if (canAdd(c, currentCandidates)) add(c);
  }

  // Repair pass: ensure global rules by targeted additions/replacements.
  const asCandidates = () => result.map((r) => byId[r.id]).filter((x): x is Candidate => !!x);
  let current = asCandidates();

  if (!current.some((i) => NL_SOURCES.has(i.source))) {
    const nl = available.find((c) => NL_SOURCES.has(c.source));
    if (nl && result.length < EDITION_SIZE) add(nl);
  }
  current = asCandidates();
  if (!current.some(isLongread)) {
    const longread = available.find(isLongread);
    if (longread && result.length < EDITION_SIZE) add(longread);
  }
  current = asCandidates();
  if (!current.some(isSurprise)) {
    const surprise = available.find(isSurprise);
    if (surprise && result.length < EDITION_SIZE) add(surprise);
  }

  current = asCandidates();
  if (!meetsGlobalRules(current)) {
    console.warn("Curator constraints not fully satisfied after repair pass");
  }

  return result;
}

const MAX_PER_SOURCE = 2;
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
  const tasteContext = await fetchTasteContext();
  const raw = await runCurator(candidates, profile, tasteContext);
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
