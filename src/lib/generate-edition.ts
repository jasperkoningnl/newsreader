import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { article_likes, articles, editions, sources, taste_entries } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
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

const SOURCE_LIMIT = 2;
const NL_SOURCES = new Set(["NOS Nieuws", "NRC", "Follow the Money"]);
const BREAKING_WORDS = ["breaking", "live", "zojuist", "net binnen", "urgent", "ontwikkelt", "update"];
const LONGREAD_WORDS = ["analyse", "essay", "longread", "interview", "achtergrond", "dossier"];
const EXPECTED_CATEGORIES = new Set(["tech", "nieuws", "series", "sport", "games", "wetenschap", "cultuur"]);

type PreferenceContext = {
  preferredSources: Set<string>;
  preferredTopics: Set<string>;
};

async function fetchPreferenceContext(): Promise<PreferenceContext> {
  const likes = await db
    .select({ source: sources.name, topic: article_likes.topic })
    .from(article_likes)
    .leftJoin(sources, eq(article_likes.source_id, sources.id))
    .where(eq(article_likes.liked, 1));

  const sourceCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  for (const row of likes) {
    const source = (row.source ?? "").trim();
    const topic = String(row.topic ?? "overig").toLowerCase().trim() || "overig";
    if (source) sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
  }

  return {
    preferredSources: new Set(Object.entries(sourceCounts).filter(([, n]) => n > 3).map(([k]) => k)),
    preferredTopics: new Set(Object.entries(topicCounts).filter(([, n]) => n > 3).map(([k]) => k)),
  };
}

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

async function runCurator(candidates: Candidate[], profile: string, tasteContext: string, pref: PreferenceContext): Promise<CuratorItem[]> {
  const list = candidates
    .map(
      (a) =>
        `ID ${a.id} | bron: ${a.source} | categorie: ${a.category ?? "overig"} | ${a.title}\n  ${a.description?.slice(0, 200) ?? "(geen beschrijving)"}`
    )
    .join("\n\n");

  const prefContext = `\nVoorrang op basis van likes (>3):\n- Bronnen: ${[...pref.preferredSources].join(", ") || "geen"}\n- Onderwerpen/categorieën: ${[...pref.preferredTopics].join(", ") || "geen"}\n`;
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Hier is Jasper's profiel en smaakvoorkeur:
${profile}${tasteContext}${prefContext}

Selecteer precies 15 artikelen uit de onderstaande lijst die samen de beste dagelijkse feed vormen.
Context: de app publiceert uiteindelijk 10 items. Deze overselectie (15 -> 10)
wordt bewust gebruikt om na constraint-enforcement een gevarieerdere top-10 over te houden.

HARDE REGELS (verplicht, geen uitzonderingen):
- Maximaal ${SOURCE_LIMIT} items van dezelfde bron (bijv. max ${SOURCE_LIMIT} van "The Verge")
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

function getConstraintViolations(items: Candidate[]): string[] {
  const violations: string[] = [];
  const sourceCounts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.source] = (acc[i.source] ?? 0) + 1;
    return acc;
  }, {});
  const categoryCounts = items.reduce<Record<string, number>>((acc, i) => {
    const cat = (i.category ?? "overig").toLowerCase();
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  if (!items.some((i) => NL_SOURCES.has(i.source))) violations.push("missing_nl_item");
  if (!items.some(isLongread)) violations.push("missing_longread");
  if (!items.some(isSurprise)) violations.push("missing_surprise");
  if (items.filter(isBreaking).length > 2) violations.push("too_many_breaking");
  if (Object.values(sourceCounts).some((n) => n > SOURCE_LIMIT)) violations.push("source_limit_exceeded");
  if (Object.values(categoryCounts).some((n) => n > 3)) violations.push("category_limit_exceeded");
  return violations;
}

function enforceConstraints(selected: CuratorItem[], candidates: Candidate[]): { items: CuratorItem[]; violations: string[] } {
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const curatedById = Object.fromEntries(selected.map((s) => [s.id, s]));

  const sourceCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const result: CuratorItem[] = [];

  const canAdd = (c: Candidate, current: Candidate[]) => {
    const sourceCount = sourceCounts[c.source] ?? 0;
    if (sourceCount >= SOURCE_LIMIT) return false;
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
  const violations = getConstraintViolations(current);
  if (violations.length > 0 || !meetsGlobalRules(current)) {
    console.warn("[edition.constraints] not_fully_satisfied", { violations });
  }

  return { items: result, violations };
}

const MAX_PER_SOURCE = SOURCE_LIMIT;
// Productkeuze: de dagelijkse editie toont 10 items.
// We vragen de curator om 15 suggesties en knippen daarna terug naar 10,
// zodat we na hard constraint-enforcement (mix/diversiteit) nog genoeg variatie overhouden.
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
    .where(and(
      eq(articles.read, 0),
      gte(articles.fetched_at, threeDaysAgo),
      isNotNull(articles.image_url),
      ne(articles.image_url, ""),
    ))
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
  const pref = await fetchPreferenceContext();
  const score = (c: Candidate) => {
    const cat = String(c.category ?? "overig").toLowerCase();
    return (pref.preferredSources.has(c.source) ? 2 : 0) + (pref.preferredTopics.has(cat) ? 2 : 0);
  };

  candidates.sort((a, b) => score(b) - score(a));

  const seed = process.env.CURATOR_DEBUG_SEED ?? "";
  if (seed) {
    const seeded = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return h >>> 0;
    };
    candidates.sort((a, b) => seeded(`${seed}:${a.id}`) - seeded(`${seed}:${b.id}`));
  } else {
    candidates.sort(() => Math.random() - 0.5);
  }

  if (candidates.length < 5) {
    throw new Error("Te weinig kandidaat-artikelen met afbeelding (< 5). Haal eerst feeds op.");
  }

  const uniqueSources = new Set(candidates.map((c) => c.source));
  console.log(`Curator: ${candidates.length} kandidaten van ${uniqueSources.size} bronnen:`, [...uniqueSources].join(", "));

  const profile = readFileSync(join(process.cwd(), "profile.md"), "utf-8");
  const tasteContext = await fetchTasteContext();
  const raw = await runCurator(candidates, profile, tasteContext, pref);
  const constrained = enforceConstraints(raw, candidates);
  const selected = constrained.items.slice(0, EDITION_SIZE);

  if (!selected.length) throw new Error("Curator selecteerde geen artikelen na constraints");

  const itemsJson = JSON.stringify(selected);
  const [edition] = await db.insert(editions).values({ items_json: itemsJson }).returning();
  console.log("[edition.generated]", JSON.stringify({
    edition_id: edition.id,
    candidate_count: candidates.length,
    selected_count: selected.length,
    violations: constrained.violations,
    seed: seed || null,
    preferred_sources: [...pref.preferredSources],
    preferred_topics: [...pref.preferredTopics],
  }));

  await db
    .update(articles)
    .set({ read: 1 })
    .where(inArray(articles.id, selected.map((s) => s.id)));

  return { edition_id: edition.id, count: selected.length };
}
