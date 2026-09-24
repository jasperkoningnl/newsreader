import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { article_likes, articles, editions, sources } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { detectPaywall } from "./paywall-detect";
import { promoteSignalsToArticles } from "./promote-signals";
import { cleanHtmlText } from "./html-text";
import { EDITION_SIZE, LOCAL_CATEGORY, OTHER_CATEGORY, fetchCategoryMix, mixLookup, normalizeCategory, type MixRow } from "./category-mix";
import { classifyCandidates, fetchPreferenceContext, fetchTopicStates, labelPendingArticles, type PreferenceContext } from "./taste";

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
  topic: string | null;
  taste: number;
};

type CuratorItem = { id: number; motivatie: string };

const SOURCE_LIMIT = 2;
const TOPIC_LIMIT = 2;
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
const BREAKING_WORDS = ["breaking", "live", "zojuist", "net binnen", "urgent", "ontwikkelt", "update"];
const LONGREAD_WORDS = ["analyse", "essay", "longread", "interview", "achtergrond", "dossier"];

async function fetchFeedbackExamples(): Promise<string> {
  const recent = await db
    .select({ title: articles.title, source: sources.name, liked: article_likes.liked })
    .from(article_likes)
    .innerJoin(articles, eq(article_likes.article_id, articles.id))
    .leftJoin(sources, eq(article_likes.source_id, sources.id))
    .orderBy(desc(article_likes.created_at))
    .limit(30);

  if (!recent.length) return "";

  const lines = recent.map(
    (r) => `${r.liked === 0 ? "✗" : "✓"} ${cleanHtmlText(r.title)}${r.source ? ` (${r.source})` : ""}`
  );
  return `\nRecent beoordeelde artikelen (✓ = like, ✗ = minder hiervan). Gebruik dit om te zien welk soort stuk Jasper wel/niet wil, niet alleen welke bron:\n${lines.join("\n")}\n`;
}

function mixPrompt(candidates: Candidate[], mixRows: MixRow[]): string {
  const present = new Set(candidates.map((c) => normalizeCategory(c.category)));
  const mix = mixLookup(mixRows);
  return [...new Set([...mixRows.filter((r) => r.min > 0).map((r) => r.category), ...present])]
    .sort()
    .map((cat) => {
      const { min, max } = mix(cat);
      return `- ${cat}: ${min === max ? min : `${min}-${max}`}${cat === "local" ? " (Nederlandstalig)" : ""}`;
    })
    .join("\n");
}

async function runCurator(
  candidates: Candidate[],
  profile: string,
  feedbackExamples: string,
  pref: PreferenceContext,
  mixRows: MixRow[]
): Promise<CuratorItem[]> {
  const list = candidates
    .map((a) => {
      const signal = a.signal_score > 0 ? ` | signaal=${a.signal_score.toFixed(1)}` : "";
      const taste = a.topic && a.taste !== 0 ? ` | smaak=${a.taste > 0 ? "+" : ""}${a.taste} (${a.topic})` : "";
      return `ID ${a.id} | bron: ${a.source}${a.is_paywall ? " (paywall)" : ""} | categorie: ${normalizeCategory(a.category)}${signal}${taste} | ${a.title}\n  ${a.description?.slice(0, 200) ?? "(geen beschrijving)"}`;
    })
    .join("\n\n");

  const prefContext = `\nVoorrang op basis van likes (>3 en meer likes dan dislikes):\n- Bronnen: ${[...pref.preferredSources].join(", ") || "geen"}\n- Onderwerpen/categorieën: ${[...pref.preferredTopics].join(", ") || "geen"}\n\nDeprioriteer op basis van dislikes (≥3 en meer dislikes dan likes):\n- Bronnen: ${[...pref.dislikedSources].join(", ") || "geen"}\n- Onderwerpen/categorieën: ${[...pref.dislikedTopics].join(", ") || "geen"}\n`;

  const systemPrompt = `Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Hier is Jasper's profiel:
${profile}

De gebruiker geeft je een lijst kandidaat-artikelen plus actuele smaak- en voorkeurssignalen.
Selecteer precies 15 artikelen die samen de beste dagelijkse feed vormen.
Context: de app publiceert uiteindelijk 10 items. Deze overselectie (15 -> 10)
wordt bewust gebruikt om na constraint-enforcement een gevarieerdere top-10 over te houden.

HARDE REGELS (verplicht, geen uitzonderingen):
- Maximaal ${SOURCE_LIMIT} items van dezelfde bron (bijv. max ${SOURCE_LIMIT} van "The Verge")
- Per categorie minimaal en maximaal het aantal uit MIX PER CATEGORIE hieronder (geldt voor de uiteindelijke ${EDITION_SIZE} items)
- Minstens 1 longread (schat in op basis van titel/beschrijving)
- Maximaal 2 breaking-news items; de rest moet een dag later nog leesbaar zijn
- Maximaal ${PAYWALL_LIMIT} items achter een paywall (gemarkeerd met "(paywall)")
- Maximaal ${TOPIC_LIMIT} items met hetzelfde smaak-onderwerp
- 1 verrassingsitem uit een categorie buiten ${expectedCategories(mixRows).join(", ") || "de mix"} (serendipity)

SIGNALEN (Reddit-saved/upvoted, Bluesky-likes/reposts):
- Items met "signaal=X" zijn opgepikt uit Jasper's eigen activiteit. Hoe hoger, hoe sterker.
- Geef voorkeur aan signaal>=1.0 wanneer het item artikel-waardig is (langer leesbaar stuk, geen meme/screenshot/korte clip).
- Wees STRENG: niet elk gesaved Reddit-link is feed-waardig. Sla items over die duidelijk geen leesartikel zijn (humor-posts, korte plaatjes-context, twitter-screenshots, listicles zonder substance), zelfs bij hoog signaal.
- Probeer minstens 1 item met signaal>=0.5 te selecteren als die er is — dat houdt de feed verbonden met wat Jasper actief volgt.

SMAAK (per onderwerp, afgeleid uit Jasper's likes, dislikes en bewaarde artikelen, of door hem zelf ingesteld):
- "smaak=+2" of "+1": geef voorrang, maar alleen binnen de mix hieronder. Smaak mag de mix nooit laten kantelen naar één onderwerp.
- "smaak=-1": kies alleen als het stuk echt uitzonderlijk is.
- Items zonder smaak-markering zijn neutraal, niet slechter.

MIX PER CATEGORIE (min-max items van de ${EDITION_SIZE}, ingesteld door Jasper):
${mixPrompt(candidates, mixRows)}

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
        content: `Voorkeurscontext:${feedbackExamples}${prefContext}
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

function expectedCategories(mixRows: MixRow[]): string[] {
  return mixRows.filter((r) => r.min > 0).map((r) => r.category);
}

function surpriseCheck(mixRows: MixRow[]): (item: Candidate) => boolean {
  const expected = new Set(expectedCategories(mixRows));
  return (item) => !expected.has(normalizeCategory(item.category));
}

function getConstraintViolations(items: Candidate[], mixRows: MixRow[]): string[] {
  const mix = mixLookup(mixRows);
  const isSurprise = surpriseCheck(mixRows);
  const violations: string[] = [];
  const count = (pred: (c: Candidate) => boolean) => items.filter(pred).length;
  const sources = new Set(items.map((c) => c.source));
  const categories = new Set([...items.map((c) => normalizeCategory(c.category)), ...mixRows.map((r) => r.category)]);

  if (!items.some(isLongread)) violations.push("missing_longread");
  if (!items.some(isSurprise)) violations.push("missing_surprise");
  if (count(isBreaking) > 2) violations.push("too_many_breaking");
  if ([...sources].some((src) => count((c) => c.source === src) > SOURCE_LIMIT)) violations.push("source_limit_exceeded");
  for (const cat of categories) {
    const n = count((c) => normalizeCategory(c.category) === cat);
    if (n > mix(cat).max) violations.push(`category_max_exceeded:${cat}`);
    if (n < mix(cat).min) violations.push(`category_min_missing:${cat}`);
  }
  if (count((c) => c.is_paywall) > PAYWALL_LIMIT) violations.push("paywall_limit_exceeded");
  return violations;
}

function enforceConstraints(
  selected: CuratorItem[],
  candidates: Candidate[],
  mixRows: MixRow[]
): { items: CuratorItem[]; violations: string[] } {
  const mix = mixLookup(mixRows);
  const isSurprise = surpriseCheck(mixRows);
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const curatedById = Object.fromEntries(selected.map((s) => [s.id, s]));
  const result: Candidate[] = [];
  const motivations = new Map<number, string>();

  const countIn = (items: Candidate[], pred: (c: Candidate) => boolean) => items.filter(pred).length;
  const sameCat = (cat: string) => (c: Candidate) => normalizeCategory(c.category) === cat;

  const fits = (items: Candidate[], c: Candidate, relaxCategoryMax = false) => {
    if (countIn(items, (x) => x.source === c.source) > SOURCE_LIMIT) return false;
    const cat = normalizeCategory(c.category);
    if (!relaxCategoryMax && countIn(items, sameCat(cat)) > mix(cat).max) return false;
    if (countIn(items, isBreaking) > 2) return false;
    if (countIn(items, (x) => x.is_paywall) > PAYWALL_LIMIT) return false;
    if (c.topic && countIn(items, (x) => x.topic === c.topic) > TOPIC_LIMIT) return false;
    return true;
  };
  const canAdd = (c: Candidate, relaxCategoryMax = false) =>
    !result.includes(c) && fits([...result, c], c, relaxCategoryMax);
  const add = (c: Candidate, motivatie: string) => {
    result.push(c);
    motivations.set(c.id, curatedById[c.id]?.motivatie ?? motivatie);
  };

  for (const item of selected) {
    if (result.length >= EDITION_SIZE) break;
    const c = byId[item.id];
    if (c && canAdd(c)) add(c, "");
  }
  for (const c of candidates) {
    if (result.length >= EDITION_SIZE) break;
    if (canAdd(c)) add(c, "Toegevoegd om aan mixregels te voldoen.");
  }
  // Too few candidates to fill the edition within the category maxima: better a full edition than a short one.
  let relaxed = false;
  for (const c of candidates) {
    if (result.length >= EDITION_SIZE) break;
    if (canAdd(c, true)) {
      add(c, "Toegevoegd om de editie te vullen.");
      relaxed = true;
    }
  }

  const ensure = (predicate: (c: Candidate) => boolean, need: number, motivatie: string) => {
    if (countIn(result, predicate) >= need) return;
    const newItem = candidates.find((c) => predicate(c) && !result.includes(c));
    if (!newItem) return;

    if (result.length < EDITION_SIZE && canAdd(newItem)) {
      add(newItem, motivatie);
      return;
    }

    const kept: Array<(items: Candidate[]) => boolean> = [];
    if (result.some(isLongread)) kept.push((it) => it.some(isLongread));
    if (result.some(isSurprise)) kept.push((it) => it.some(isSurprise));
    for (const row of mixRows) {
      if (row.min > 0 && countIn(result, sameCat(row.category)) >= row.min) {
        kept.push((it) => countIn(it, sameCat(row.category)) >= row.min);
      }
    }

    // Replace from the bottom up: the curator's lowest-ranked picks go first.
    for (let i = result.length - 1; i >= 0; i--) {
      if (predicate(result[i])) continue;
      const swapped = result.map((c, idx) => (idx === i ? newItem : c));
      if (!kept.every((rule) => rule(swapped)) || !fits(swapped, newItem)) continue;
      motivations.delete(result[i].id);
      result[i] = newItem;
      motivations.set(newItem.id, curatedById[newItem.id]?.motivatie ?? motivatie);
      return;
    }
  };

  for (const row of mixRows.filter((r) => r.min > 0)) {
    for (let need = 1; need <= row.min; need++) {
      ensure(sameCat(row.category), need, `Toegevoegd voor de mix (${row.category}).`);
    }
  }
  ensure(isLongread, 1, "Toegevoegd om aan de longread-regel te voldoen.");
  ensure(isSurprise, 1, "Toegevoegd als verrassingsitem buiten de verwachte categorieën.");

  const violations = getConstraintViolations(result, mixRows);
  if (relaxed) violations.push("category_max_relaxed_to_fill");
  if (violations.length > 0) {
    console.warn("[edition.constraints] not_fully_satisfied", { violations });
  }

  return { items: result.map((c) => ({ id: c.id, motivatie: motivations.get(c.id) ?? "" })), violations };
}

const MAX_PER_SOURCE = SOURCE_LIMIT;

type TasteLog = {
  labeled: number;
  weighted_topics: number;
  matched: number;
  recategorized: number;
  removed: { topic: string; title: string }[];
};

// Local is a language choice, not a subject, so it stays with the source; other is only a fallback.
function classifiableCategories(mixRows: MixRow[]): string[] {
  return mixRows.map((r) => r.category).filter((c) => c !== LOCAL_CATEGORY && c !== OTHER_CATEGORY);
}

// Sets each candidate's category from its content, filters "never" topics out in place and tags the rest with their taste weight.
async function applyClassification(candidates: Candidate[], mixRows: MixRow[]): Promise<TasteLog> {
  const log: TasteLog = { labeled: 0, weighted_topics: 0, matched: 0, recategorized: 0, removed: [] };
  try {
    log.labeled = await labelPendingArticles();
  } catch (error) {
    console.error("[edition.label] failed (continuing with existing labels)", error);
  }
  try {
    const weighted = (await fetchTopicStates()).filter((t) => t.weight !== 0);
    log.weighted_topics = weighted.length;
    const { topics, categories } = await classifyCandidates(candidates, weighted, classifiableCategories(mixRows));
    log.matched = topics.size;

    const changed = new Map<string, number[]>();
    for (const c of candidates) {
      const category = categories.get(c.id);
      if (!category || normalizeCategory(c.category) === LOCAL_CATEGORY || normalizeCategory(c.category) === category) continue;
      c.category = category;
      changed.set(category, [...(changed.get(category) ?? []), c.id]);
      log.recategorized++;
    }
    try {
      for (const [category, ids] of changed) {
        await db.update(articles).set({ category }).where(inArray(articles.id, ids));
      }
    } catch (error) {
      console.error("[edition.category] persist failed (edition uses the new categories anyway)", error);
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
      const topic = topics.get(candidates[i].id);
      if (!topic) continue;
      if (topic.weight <= -2) {
        log.removed.push({ topic: topic.label, title: candidates[i].title });
        candidates.splice(i, 1);
        continue;
      }
      candidates[i].topic = topic.label;
      candidates[i].taste = topic.weight;
    }
  } catch (error) {
    console.error("[edition.classify] failed (continuing with source categories and without topic taste)", error);
  }
  return log;
}

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
      topic: null,
      taste: 0,
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
  const mixRows = await fetchCategoryMix();
  const tasteLog = await applyClassification(candidates, mixRows);
  const score = (c: Candidate) => {
    const cat = normalizeCategory(c.category);
    return (
      c.taste * 2 +
      (pref.preferredSources.has(c.source) ? 2 : 0) +
      (pref.preferredTopics.has(cat) ? 2 : 0) -
      (pref.dislikedSources.has(c.source) ? 3 : 0) -
      (pref.dislikedTopics.has(cat) ? 3 : 0)
    );
  };

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
  // Shuffle first, then a stable sort on score: ties stay random, but likes/dislikes decide the order.
  candidates.sort((a, b) => score(b) - score(a));

  if (candidates.length < 5) {
    throw new Error("Te weinig kandidaat-artikelen met afbeelding (< 5). Haal eerst feeds op.");
  }

  const uniqueSources = new Set(candidates.map((c) => c.source));
  console.log(`Curator: ${candidates.length} kandidaten van ${uniqueSources.size} bronnen:`, [...uniqueSources].join(", "));

  const profile = readFileSync(join(process.cwd(), "profile.md"), "utf-8");
  const feedbackExamples = await fetchFeedbackExamples();
  const raw = await runCurator(candidates, profile, feedbackExamples, pref, mixRows);
  const constrained = enforceConstraints(raw, candidates, mixRows);
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
    taste: tasteLog,
  }));

  await db
    .update(articles)
    .set({ read: 1 })
    .where(inArray(articles.id, selected.map((s) => s.id)));

  return { edition_id: edition.id, count: selected.length };
}
