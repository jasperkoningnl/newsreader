import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { article_likes, articles, editions, sources, taste_entries } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { detectPaywall } from "./paywall-detect";
import { promoteSignalsToArticles } from "./promote-signals";
import { cleanHtmlText } from "./html-text";

const client = new Anthropic();

type Candidate = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  category: string | null;
  published_at: string | null;
  source: string;
  is_paywall: boolean;
  signal_score: number;
};

type CuratorItem = { id: number; motivatie: string };

const SOURCE_LIMIT = 2;
const PAYWALL_LIMIT = 2;
const PAYWALL_CONCURRENCY = 5;

async function detectPaywallBatch(
  items: { id: number; url: string }[]
): Promise<Map<number, boolean | null>> {
  const result = new Map<number, boolean | null>();
  let cursor = 0;
  const now = sql`(datetime('now'))`;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      const verdict = await detectPaywall(item.url);
      result.set(item.id, verdict.is_paywall);
      try {
        await db
          .update(articles)
          .set({
            is_paywall: verdict.is_paywall === null ? null : verdict.is_paywall ? 1 : 0,
            paywall_checked_at: now,
          })
          .where(eq(articles.id, item.id));
      } catch (err) {
        console.warn("[paywall.persist] failed", item.id, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(PAYWALL_CONCURRENCY, items.length) }, worker);
  await Promise.all(workers);
  return result;
}
const NL_CATEGORY = "local";
const BREAKING_WORDS = ["breaking", "live", "zojuist", "net binnen", "urgent", "ontwikkelt", "update"];
const LONGREAD_WORDS = ["analyse", "essay", "longread", "interview", "achtergrond", "dossier"];
const EXPECTED_CATEGORIES = new Set(["tech", "nieuws", "series", "sport", "games", "wetenschap", "cultuur", "local"]);

type PreferenceContext = {
  preferredSources: Set<string>;
  preferredTopics: Set<string>;
  dislikedSources: Set<string>;
  dislikedTopics: Set<string>;
};

const LIKE_THRESHOLD = 3;
const DISLIKE_THRESHOLD = 2;

async function fetchPreferenceContext(): Promise<PreferenceContext> {
  const rows = await db
    .select({ source: sources.name, topic: article_likes.topic, liked: article_likes.liked })
    .from(article_likes)
    .leftJoin(sources, eq(article_likes.source_id, sources.id));

  const likeSrc: Record<string, number> = {};
  const likeTop: Record<string, number> = {};
  const dislikeSrc: Record<string, number> = {};
  const dislikeTop: Record<string, number> = {};
  for (const row of rows) {
    const source = (row.source ?? "").trim();
    const topic = String(row.topic ?? "overig").toLowerCase().trim() || "overig";
    const buckets = row.liked === 0 ? [dislikeSrc, dislikeTop] : [likeSrc, likeTop];
    if (source) buckets[0][source] = (buckets[0][source] ?? 0) + 1;
    buckets[1][topic] = (buckets[1][topic] ?? 0) + 1;
  }

  return {
    preferredSources: new Set(Object.entries(likeSrc).filter(([, n]) => n > LIKE_THRESHOLD).map(([k]) => k)),
    preferredTopics: new Set(Object.entries(likeTop).filter(([, n]) => n > LIKE_THRESHOLD).map(([k]) => k)),
    dislikedSources: new Set(Object.entries(dislikeSrc).filter(([, n]) => n >= DISLIKE_THRESHOLD).map(([k]) => k)),
    dislikedTopics: new Set(Object.entries(dislikeTop).filter(([, n]) => n >= DISLIKE_THRESHOLD).map(([k]) => k)),
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
    .map((a) => {
      const signal = a.signal_score > 0 ? ` | signaal=${a.signal_score.toFixed(1)}` : "";
      return `ID ${a.id} | bron: ${a.source}${a.is_paywall ? " (paywall)" : ""} | categorie: ${a.category ?? "overig"}${signal} | ${a.title}\n  ${a.description?.slice(0, 200) ?? "(geen beschrijving)"}`;
    })
    .join("\n\n");

  const prefContext = `\nVoorrang op basis van likes (>3):\n- Bronnen: ${[...pref.preferredSources].join(", ") || "geen"}\n- Onderwerpen/categorieën: ${[...pref.preferredTopics].join(", ") || "geen"}\n\nDeprioriteer op basis van dislikes (≥2):\n- Bronnen: ${[...pref.dislikedSources].join(", ") || "geen"}\n- Onderwerpen/categorieën: ${[...pref.dislikedTopics].join(", ") || "geen"}\n`;

  const systemPrompt = `Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Hier is Jasper's profiel:
${profile}

De gebruiker geeft je een lijst kandidaat-artikelen plus actuele smaak- en voorkeurssignalen.
Selecteer precies 15 artikelen die samen de beste dagelijkse feed vormen.
Context: de app publiceert uiteindelijk 10 items. Deze overselectie (15 -> 10)
wordt bewust gebruikt om na constraint-enforcement een gevarieerdere top-10 over te houden.

HARDE REGELS (verplicht, geen uitzonderingen):
- Maximaal ${SOURCE_LIMIT} items van dezelfde bron (bijv. max ${SOURCE_LIMIT} van "The Verge")
- Maximaal 3 items uit dezelfde categorie
- Altijd minstens 1 Nederlandstalig item (categorie: local)
- Minstens 1 longread (schat in op basis van titel/beschrijving)
- Maximaal 2 breaking-news items; de rest moet een dag later nog leesbaar zijn
- Maximaal ${PAYWALL_LIMIT} items achter een paywall (gemarkeerd met "(paywall)")
- 1 verrassingsitem buiten de verwachte interesses (serendipity)

SIGNALEN (Reddit-saved/upvoted, Bluesky-likes/reposts):
- Items met "signaal=X" zijn opgepikt uit Jasper's eigen activiteit. Hoe hoger, hoe sterker.
- Geef voorkeur aan signaal>=1.0 wanneer het item artikel-waardig is (langer leesbaar stuk, geen meme/screenshot/korte clip).
- Wees STRENG: niet elk gesaved Reddit-link is feed-waardig. Sla items over die duidelijk geen leesartikel zijn (humor-posts, korte plaatjes-context, twitter-screenshots, listicles zonder substance), zelfs bij hoog signaal.
- Probeer minstens 1 item met signaal>=0.5 te selecteren als die er is — dat houdt de feed verbonden met wat Jasper actief volgt.

GEWENSTE MIX:
- 2-3 tech/AI (waarvan max 1 van dezelfde tech-bron)
- 1-2 serie/film/streaming
- 1-2 nieuws of geopolitiek (analyse, geen breaking)
- 1 sport of games
- 1 wetenschap of cultuur
- 1 verrassing

Antwoord uitsluitend als geldig JSON array (geen markdown, geen tekst erbuiten):
[{"id": <number>, "motivatie": "<één zin waarom dit item"}, ...]`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Smaak- en voorkeurscontext:${tasteContext}${prefContext}
Kandidaat-artikelen:
${list}`,
      },
    ],
  });

  const usage = msg.usage as { cache_creation_input_tokens?: number; cache_read_input_tokens?: number; input_tokens?: number; output_tokens?: number };
  console.log("[curator.usage]", JSON.stringify({
    input_tokens: usage.input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    output_tokens: usage.output_tokens,
  }));

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

function isLocal(item: Candidate): boolean {
  return (item.category ?? "").toLowerCase() === NL_CATEGORY;
}

function meetsGlobalRules(items: Candidate[]): boolean {
  const hasNl = items.some(isLocal);
  const hasLongread = items.some(isLongread);
  const breakingCount = items.filter(isBreaking).length;
  const paywallCount = items.filter((c) => c.is_paywall).length;
  const hasSurprise = items.some(isSurprise);
  return hasNl && hasLongread && breakingCount <= 2 && paywallCount <= PAYWALL_LIMIT && hasSurprise;
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

  if (!items.some(isLocal)) violations.push("missing_nl_item");
  if (!items.some(isLongread)) violations.push("missing_longread");
  if (!items.some(isSurprise)) violations.push("missing_surprise");
  if (items.filter(isBreaking).length > 2) violations.push("too_many_breaking");
  if (Object.values(sourceCounts).some((n) => n > SOURCE_LIMIT)) violations.push("source_limit_exceeded");
  if (Object.values(categoryCounts).some((n) => n > 3)) violations.push("category_limit_exceeded");
  if (items.filter((c) => c.is_paywall).length > PAYWALL_LIMIT) violations.push("paywall_limit_exceeded");
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
    const paywallCount = current.filter((x) => x.is_paywall).length;
    if (c.is_paywall && paywallCount >= PAYWALL_LIMIT) return false;
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

  const asCandidates = () => result.map((r) => byId[r.id]).filter((x): x is Candidate => !!x);

  const ensureRule = (predicate: (c: Candidate) => boolean, motivatie: string) => {
    const before = asCandidates();
    if (before.some(predicate)) return;

    const newItem = candidates.find((c) => predicate(c) && !result.some((r) => r.id === c.id));
    if (!newItem) return;

    if (result.length < EDITION_SIZE && canAdd(newItem, before)) {
      add(newItem);
      return;
    }

    const protect: Array<(items: Candidate[]) => boolean> = [];
    if (predicate !== isLocal && before.some(isLocal)) protect.push((it) => it.some(isLocal));
    if (predicate !== isLongread && before.some(isLongread)) protect.push((it) => it.some(isLongread));
    if (predicate !== isSurprise && before.some(isSurprise)) protect.push((it) => it.some(isSurprise));

    for (let i = 0; i < result.length; i++) {
      const removed = byId[result[i].id];
      if (!removed) continue;
      const without = before.filter((_, idx) => idx !== i);
      const withNew = [...without, newItem];

      if (!protect.every((rule) => rule(withNew))) continue;

      const newCat = (newItem.category ?? "overig").toLowerCase();
      const okSource = withNew.filter((c) => c.source === newItem.source).length <= SOURCE_LIMIT;
      const okCat = withNew.filter((c) => (c.category ?? "overig").toLowerCase() === newCat).length <= 3;
      const okBreaking = withNew.filter(isBreaking).length <= 2;
      const okPaywall = withNew.filter((c) => c.is_paywall).length <= PAYWALL_LIMIT;
      if (!okSource || !okCat || !okBreaking || !okPaywall) continue;

      const removedCat = (removed.category ?? "overig").toLowerCase();
      sourceCounts[removed.source] = (sourceCounts[removed.source] ?? 0) - 1;
      categoryCounts[removedCat] = (categoryCounts[removedCat] ?? 0) - 1;
      sourceCounts[newItem.source] = (sourceCounts[newItem.source] ?? 0) + 1;
      categoryCounts[newCat] = (categoryCounts[newCat] ?? 0) + 1;
      result[i] = curatedById[newItem.id] ?? { id: newItem.id, motivatie };
      return;
    }
  };

  ensureRule(isLocal, "Toegevoegd voor NL-item (categorie local).");
  ensureRule(isLongread, "Toegevoegd om aan de longread-regel te voldoen.");
  ensureRule(isSurprise, "Toegevoegd als verrassingsitem buiten de verwachte categorieën.");

  const final = asCandidates();
  const violations = getConstraintViolations(final);
  if (violations.length > 0 || !meetsGlobalRules(final)) {
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

  try {
    const promote = await promoteSignalsToArticles();
    console.log("[edition.signals]", JSON.stringify(promote));
  } catch (error) {
    console.error("[edition.signals] failed (continuing without)", error);
  }

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
      article_paywall: articles.is_paywall,
      source_paywall: sources.is_paywall,
      signal_score: articles.signal_score,
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
  const undetected: { id: number; url: string }[] = [];
  for (const a of all) {
    const n = countPerSource[a.source] ?? 0;
    if (n >= MAX_PER_SOURCE) continue;
    const effective = a.article_paywall ?? a.source_paywall ?? 0;
    candidates.push({
      id: a.id,
      title: cleanHtmlText(a.title),
      description: a.description ? cleanHtmlText(a.description) : null,
      url: a.url,
      category: a.category,
      published_at: a.published_at,
      source: a.source,
      is_paywall: effective === 1,
      signal_score: a.signal_score ?? 0,
    });
    if (a.article_paywall === null) undetected.push({ id: a.id, url: a.url });
    countPerSource[a.source] = n + 1;
  }

  if (undetected.length) {
    const updates = await detectPaywallBatch(undetected);
    for (const c of candidates) {
      const v = updates.get(c.id);
      if (v !== undefined && v !== null) c.is_paywall = v;
    }
    console.log(
      `[edition.paywall-scan] checked=${undetected.length} hits=${[...updates.values()].filter((v) => v === true).length} unknown=${[...updates.values()].filter((v) => v === null).length}`
    );
  }
  const pref = await fetchPreferenceContext();
  const score = (c: Candidate) => {
    const cat = String(c.category ?? "overig").toLowerCase();
    return (
      (pref.preferredSources.has(c.source) ? 2 : 0) +
      (pref.preferredTopics.has(cat) ? 2 : 0) -
      (pref.dislikedSources.has(c.source) ? 3 : 0) -
      (pref.dislikedTopics.has(cat) ? 3 : 0)
    );
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
  const paywallSelected = selected.reduce((acc, s) => {
    const c = candidates.find((x) => x.id === s.id);
    return acc + (c?.is_paywall ? 1 : 0);
  }, 0);
  console.log("[edition.generated]", JSON.stringify({
    edition_id: edition.id,
    candidate_count: candidates.length,
    selected_count: selected.length,
    paywall_count: paywallSelected,
    violations: constrained.violations,
    seed: seed || null,
    preferred_sources: [...pref.preferredSources],
    preferred_topics: [...pref.preferredTopics],
    disliked_sources: [...pref.dislikedSources],
    disliked_topics: [...pref.dislikedTopics],
  }));

  await db
    .update(articles)
    .set({ read: 1 })
    .where(inArray(articles.id, selected.map((s) => s.id)));

  return { edition_id: edition.id, count: selected.length };
}
