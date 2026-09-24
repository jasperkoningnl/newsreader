import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { article_likes, articles, editions, saved_articles, sources } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { extractArticleContent } from "./extract-article";
import { generateEdition } from "./generate-edition";
import { cleanHtmlText } from "./html-text";
import { classifyCandidates, fetchTopicStates } from "./taste";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";

export type SundayRole = "longread" | "background" | "highlight";

export type SundayTip = {
  kind: "game" | "series";
  name: string;
  platforms: string[];
  when: string | null;
  text: string;
  quote: string;
  article_id: number;
  article_title: string;
  source: string;
};

export type SundayPayload = {
  items: { id: number; motivatie: string; role: SundayRole; minutes: number | null }[];
  tips: SundayTip[];
  saved_ids: number[];
};

type Candidate = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  source: string;
  source_category: string;
  is_paywall: boolean;
  topic: string | null;
  taste: number;
};

type Pick = { id: number; motivatie: string };
type Selection = { longread: Pick[]; background: Pick[]; game: number[]; series: number[]; highlights: Pick[] };
type TipDraft = { id: number; kind: "game" | "series"; name: string; platforms: string[]; when: string; text: string; quote: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HIGHLIGHTS = 6;
const SOURCE_LIMIT = 2;
const PAYWALL_LIMIT = 2;
const TIP_POOL_PER_KIND = 25;
const TIP_POOL_PER_SOURCE = 5;
const TIP_CANDIDATES = 4;
const LONGREAD_MIN_WORDS = 1200;
const WORDS_PER_MINUTE = 230;
const TIP_TEXT_CHARS = 12000;
const GAME_CATEGORIES = ["games"];
const SERIES_CATEGORIES = ["series"];

// A game only qualifies when the quoted sentence itself names a way to play it on a PC or Android.
const PC_EVIDENCE = [
  /\bpcs?\b/i,
  /\bWindows\b/,
  /\bSteam\b/,
  /\bEpic Games\b/i,
  /\bGOG\b|\bgog\.com\b/i,
  /\bitch\.io\b/i,
  /\bHumble (Bundle|Store)\b/i,
  /\bAndroid\b/i,
  /\bGoogle Play\b|\bPlay Store\b/i,
  /\bbrowser\w*/i,
];

// Names the tip text may only use when the article does too.
const PLATFORM_WORDS = [
  "netflix", "hbo", "disney+", "disney plus", "apple tv", "prime video", "amazon", "videoland", "skyshowtime",
  "paramount+", "npo", "hulu", "peacock", "playstation", "ps4", "ps5", "xbox", "nintendo", "ios", "iphone",
  "ipad", "steam", "gog", "epic", "windows", "android", "mac", "macos", "linux", "itch.io",
];

function dbDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function isSundayToday(now = new Date()): boolean {
  return now.getDay() === 0;
}

// A Sunday without a Sunday edition (e.g. too few unread articles) still gets a daily edition.
export async function generateTodaysEdition(): Promise<{ edition_id: number; count: number }> {
  if (!isSundayToday()) return generateEdition();
  try {
    return await generateSundayEdition();
  } catch (error) {
    console.error("[sunday] failed, falling back to the daily edition", error);
    return generateEdition();
  }
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—‒]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(normalizedText: string, word: string): boolean {
  const escaped = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(normalizedText);
}

export function verifyTip(draft: TipDraft, articleText: string): { ok: true; tip: Omit<SundayTip, "article_id" | "article_title" | "source"> } | { ok: false; reason: string } {
  const text = normalize(articleText);
  const quote = normalize(draft.quote);
  const name = draft.name.trim();
  if (!name || !draft.text.trim()) return { ok: false, reason: "empty" };
  if (quote.length < 15 || !text.includes(quote)) return { ok: false, reason: "quote_not_in_article" };
  if (!text.includes(normalize(name))) return { ok: false, reason: "name_not_in_article" };
  if (draft.kind === "game" && !PC_EVIDENCE.some((re) => re.test(draft.quote.replace(/steam\s*deck/gi, "")))) {
    return { ok: false, reason: "no_pc_or_android_in_quote" };
  }

  const tipText = normalize(`${draft.text} ${draft.name}`);
  const invented = PLATFORM_WORDS.find((w) => mentions(tipText, w) && !mentions(text, w));
  if (invented) return { ok: false, reason: `platform_not_in_article:${invented}` };
  const year = tipText.match(/\b(19|20)\d{2}\b/g)?.find((y) => !text.includes(y));
  if (year) return { ok: false, reason: `year_not_in_article:${year}` };

  const platforms = [...new Set(draft.platforms.map((p) => p.trim()).filter((p) => p && text.includes(normalize(p))))];
  const when = draft.when.trim() && text.includes(normalize(draft.when)) ? draft.when.trim() : null;
  return { ok: true, tip: { kind: draft.kind, name, platforms, when, text: draft.text.trim(), quote: draft.quote.trim() } };
}

async function fetchTasteExamples(): Promise<string> {
  const [rated, saved] = await Promise.all([
    db
      .select({ title: articles.title, source: sources.name, liked: article_likes.liked })
      .from(article_likes)
      .innerJoin(articles, eq(article_likes.article_id, articles.id))
      .leftJoin(sources, eq(articles.source_id, sources.id))
      .orderBy(desc(article_likes.created_at))
      .limit(30),
    db
      .select({ title: articles.title, source: sources.name })
      .from(saved_articles)
      .innerJoin(articles, eq(saved_articles.article_id, articles.id))
      .leftJoin(sources, eq(articles.source_id, sources.id))
      .orderBy(desc(saved_articles.saved_at))
      .limit(20),
  ]);
  const line = (mark: string, r: { title: string; source: string | null }) =>
    `${mark} ${cleanHtmlText(r.title)}${r.source ? ` (${r.source})` : ""}`;
  return [
    ...rated.map((r) => line(r.liked === 0 ? "✗" : "✓", r)),
    ...saved.map((r) => line("★", r)),
  ].join("\n");
}

type ArticleRow = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  source: string;
  source_category: string | null;
  article_paywall: number | null;
  source_paywall: number | null;
};

function toCandidate(a: ArticleRow): Candidate {
  return {
    id: a.id,
    title: cleanHtmlText(a.title),
    description: a.description ? cleanHtmlText(a.description) : null,
    url: a.url,
    source: a.source,
    source_category: (a.source_category ?? "").toLowerCase().trim(),
    is_paywall: (a.article_paywall ?? a.source_paywall ?? 0) === 1,
    topic: null,
    taste: 0,
  };
}

const candidateColumns = {
  id: articles.id,
  title: articles.title,
  description: articles.description,
  url: articles.url,
  source: sources.name,
  source_category: sources.category,
  article_paywall: articles.is_paywall,
  source_paywall: sources.is_paywall,
};

// Liked, disliked, saved or opened articles never come back as a pick.
const untouched = and(isNull(articles.opened_at), isNull(article_likes.id), isNull(saved_articles.id));

async function fetchWeekPool(since: string): Promise<Candidate[]> {
  const dailies = await db
    .select({ items_json: editions.items_json })
    .from(editions)
    .where(and(eq(editions.kind, "daily"), gte(editions.created_at, since)));
  const ids = [...new Set(dailies.flatMap((e) => (JSON.parse(e.items_json) as { id: number }[]).map((i) => i.id)))];
  if (!ids.length) return [];

  const rows = await db
    .select(candidateColumns)
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .leftJoin(article_likes, eq(article_likes.article_id, articles.id))
    .leftJoin(saved_articles, eq(saved_articles.article_id, articles.id))
    .where(and(inArray(articles.id, ids), untouched));
  return rows.map(toCandidate);
}

async function fetchTipPool(since: string, exclude: number[], categories: string[]): Promise<Candidate[]> {
  const rows = await db
    .select(candidateColumns)
    .from(articles)
    .innerJoin(sources, eq(articles.source_id, sources.id))
    .leftJoin(article_likes, eq(article_likes.article_id, articles.id))
    .leftJoin(saved_articles, eq(saved_articles.article_id, articles.id))
    .where(and(
      gte(articles.fetched_at, since),
      inArray(sql`lower(trim(${sources.category}))`, categories),
      exclude.length ? notInArray(articles.id, exclude) : undefined,
      untouched,
    ))
    .orderBy(desc(articles.fetched_at))
    .limit(200);

  const perSource: Record<string, number> = {};
  const result: Candidate[] = [];
  for (const row of rows) {
    if (result.length >= TIP_POOL_PER_KIND) break;
    const n = perSource[row.source] ?? 0;
    if (n >= TIP_POOL_PER_SOURCE) continue;
    perSource[row.source] = n + 1;
    result.push(toCandidate(row));
  }
  return result;
}

async function applyTopicTaste(candidates: Candidate[]): Promise<string[]> {
  const removed: string[] = [];
  try {
    const weighted = (await fetchTopicStates()).filter((t) => t.weight !== 0);
    const matches = (await classifyCandidates(candidates, weighted, [])).topics;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const topic = matches.get(candidates[i].id);
      if (!topic) continue;
      if (topic.weight <= -2) {
        removed.push(candidates[i].title);
        candidates.splice(i, 1);
        continue;
      }
      candidates[i].topic = topic.label;
      candidates[i].taste = topic.weight;
    }
  } catch (error) {
    console.error("[sunday.taste] failed (continuing without topic taste)", error);
  }
  return removed;
}

function listLine(c: Candidate): string {
  const taste = c.topic ? ` | smaak=${c.taste > 0 ? "+" : ""}${c.taste} (${c.topic})` : "";
  return `ID ${c.id} | bron: ${c.source}${c.is_paywall ? " (paywall)" : ""} | categorie: ${c.source_category || "other"}${taste} | ${c.title}\n  ${c.description?.slice(0, 300) ?? "(geen beschrijving)"}`;
}

async function askJson<T>(system: string, content: string, schema: Record<string, unknown>, label: string): Promise<T> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  console.log(`[sunday.usage.${label}]`, JSON.stringify({
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    stop_reason: msg.stop_reason,
  }));
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
    throw new Error(`Zondag-curator (${label}) stopte: ${msg.stop_reason}`);
  }
  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text) as T;
}

const pickSchema = {
  type: "object",
  properties: { id: { type: "integer" }, motivatie: { type: "string" } },
  required: ["id", "motivatie"],
  additionalProperties: false,
};

const SELECTION_SCHEMA = {
  type: "object",
  properties: {
    longread: { type: "array", items: pickSchema },
    background: { type: "array", items: pickSchema },
    game: { type: "array", items: { type: "integer" } },
    series: { type: "array", items: { type: "integer" } },
    highlights: { type: "array", items: pickSchema },
  },
  required: ["longread", "background", "game", "series", "highlights"],
  additionalProperties: false,
};

const TIPS_SCHEMA = {
  type: "object",
  properties: {
    tips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          kind: { type: "string", enum: ["game", "series"] },
          name: { type: "string" },
          platforms: { type: "array", items: { type: "string" } },
          when: { type: "string" },
          text: { type: "string" },
          quote: { type: "string" },
        },
        required: ["id", "kind", "name", "platforms", "when", "text", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["tips"],
  additionalProperties: false,
};

function selectionPrompt(profile: string): string {
  return `Je bent de eindredacteur van Jasper's zondageditie: de highlights van de week voor iemand die niet elke dag leest.

Jasper's profiel:
${profile}

Je krijgt de artikelen die deze week in zijn dagelijkse edities stonden en die hij nog niet opende, likete of bewaarde. Selecteer STRENGER dan de dagelijkse editie: alleen wat een week later nog de moeite waard is. Geen breaking news dat al achterhaald is, geen korte nieuwsberichten.

Geef:
- longread: tot 3 kandidaten, beste eerst. Een lang, lekker leesbaar stuk (essay, reportage, uitgebreid interview, verhaal). Geen nieuwsbericht.
- background: tot 3 kandidaten, beste eerst. Een goed achtergrond- of analysestuk dat iets uitlegt.
- game: tot ${TIP_CANDIDATES} artikel-IDs, beste eerst, die over één specifieke game gaan die bij Jasper past (strategie, narratief, slimme puzzels; patient gamer). Mag ook uit de extra tip-kandidaten. Alleen artikelen waarin staat dat de game op pc/Windows of Android speelbaar is of verschijnt, of via Steam, Epic, GOG, itch.io of in de browser. Console-only games niet.
- series: tot ${TIP_CANDIDATES} artikel-IDs, beste eerst, die over één specifieke serie gaan die bij Jasper's smaak past. Mag ook uit de extra tip-kandidaten.
- highlights: tot 10 kandidaten, beste eerst, gevarieerd over onderwerpen en bronnen.

Regels:
- Longread, background en highlights alleen uit de weekartikelen, nooit uit de extra tip-kandidaten.
- Gebruik elk ID hooguit in één van longread, background en highlights.
- "smaak=+n" is een onderwerp waar Jasper meer van wil, "smaak=-1" minder.
- Motivatie: één Nederlandse zin waarom dit de moeite waard is.`;
}

const TIPS_PROMPT = `Je schrijft tips voor Jasper's zondageditie: één game en één serie om te proberen. Je krijgt per artikel de volledige tekst.

Schrijf per artikel hooguit één tip, alleen op basis van wat in DAT artikel staat. Past een artikel niet (het gaat niet over één specifieke game of serie, of de informatie ontbreekt), laat het dan weg.

Velden:
- kind: "game" of "series", zoals bij het artikel aangegeven.
- name: de naam van de game of serie, precies zoals in het artikel geschreven.
- platforms: bij een game de platforms of winkels die het artikel noemt (bijv. "PC", "Steam", "Android"); bij een serie de zender of streamingdienst als het artikel die noemt. Letterlijk zoals in het artikel. Noemt het artikel niets: lege lijst.
- when: releasedatum of startdatum, alleen als het artikel die noemt, letterlijk overgenomen. Anders "".
- text: 2 tot 3 zinnen in het Nederlands. Waarom Jasper dit zou willen spelen of kijken. Alleen feiten uit het artikel.
- quote: een LETTERLIJK citaat uit het artikel (één zin, exact gekopieerd). Bij een game moet in het citaat staan dat hij op pc/Windows, Android, Steam, Epic, GOG, itch.io of in de browser speelbaar is.

Verzin NOOIT een platform, winkel, streamingdienst, zender, jaartal of datum die niet in het artikel staat. Een game zonder pc- of Android-vermelding in het artikel: weglaten.`;

async function extractText(url: string): Promise<string | null> {
  const extracted = await extractArticleContent(url).catch(() => null);
  return extracted?.html ? cleanHtmlText(extracted.html) : null;
}

function minutesFor(text: string | null): number | null {
  if (!text) return null;
  return Math.max(1, Math.round(text.split(" ").length / WORDS_PER_MINUTE));
}

export async function generateSundayEdition(): Promise<{ edition_id: number; count: number }> {
  const since = dbDate(Date.now() - WEEK_MS);
  const pool = await fetchWeekPool(since);
  const poolIds = pool.map((c) => c.id);
  const [gamePool, seriesPool] = await Promise.all([
    fetchTipPool(since, poolIds, GAME_CATEGORIES),
    fetchTipPool(since, poolIds, SERIES_CATEGORIES),
  ]);
  const all = [...pool, ...gamePool, ...seriesPool];
  const removedByTaste = await applyTopicTaste(all);
  const week = all.filter((c) => poolIds.includes(c.id));
  const extra = all.filter((c) => !poolIds.includes(c.id));

  if (week.length < 5) {
    throw new Error("Te weinig ongelezen artikelen uit de edities van deze week (< 5).");
  }

  const profile = readFileSync(join(process.cwd(), "profile.md"), "utf-8");
  const examples = await fetchTasteExamples();
  const selection = await askJson<Selection>(
    selectionPrompt(profile),
    `Recent beoordeeld (✓ = like, ✗ = minder hiervan, ★ = bewaard):\n${examples || "(nog niets)"}\n\nWEEKARTIKELEN:\n${week.map(listLine).join("\n\n")}\n\nEXTRA TIP-KANDIDATEN (alleen voor game/series):\n${extra.map(listLine).join("\n\n") || "(geen)"}`,
    SELECTION_SCHEMA,
    "selection",
  );

  const byId = new Map(all.map((c) => [c.id, c]));
  const weekIds = new Set(week.map((c) => c.id));
  const used = new Set<number>();
  const items: SundayPayload["items"] = [];
  const perSource: Record<string, number> = {};
  let paywalled = 0;

  const fits = (c: Candidate) =>
    !used.has(c.id) && (perSource[c.source] ?? 0) < SOURCE_LIMIT && (!c.is_paywall || paywalled < PAYWALL_LIMIT);
  const take = (c: Candidate, motivatie: string, role: SundayRole, minutes: number | null) => {
    used.add(c.id);
    perSource[c.source] = (perSource[c.source] ?? 0) + 1;
    if (c.is_paywall) paywalled++;
    items.push({ id: c.id, motivatie, role, minutes });
  };
  const weekPicks = (picks: Pick[]) =>
    picks.flatMap((p) => {
      const c = weekIds.has(p.id) ? byId.get(p.id) : undefined;
      return c ? [{ c, motivatie: p.motivatie }] : [];
    });

  // Prefer a longread whose full text is actually long; fall back to the curator's first choice.
  const longreads = weekPicks(selection.longread).filter(({ c }) => fits(c));
  let longread: { c: Candidate; motivatie: string; minutes: number | null } | null = null;
  for (const pick of longreads) {
    const minutes = minutesFor(await extractText(pick.c.url));
    if (minutes !== null && minutes * WORDS_PER_MINUTE >= LONGREAD_MIN_WORDS) {
      longread = { ...pick, minutes };
      break;
    }
  }
  if (!longread && longreads[0]) longread = { ...longreads[0], minutes: null };
  if (longread) take(longread.c, longread.motivatie, "longread", longread.minutes);

  const background = weekPicks(selection.background).find(({ c }) => fits(c));
  if (background) take(background.c, background.motivatie, "background", minutesFor(await extractText(background.c.url)));

  const tipCandidates = (["game", "series"] as const).flatMap((kind) =>
    (kind === "game" ? selection.game : selection.series)
      .map((id) => byId.get(id))
      .filter((c): c is Candidate => !!c && !used.has(c.id))
      .slice(0, TIP_CANDIDATES)
      .map((c) => ({ kind, c })),
  );
  const texts = await Promise.all(tipCandidates.map(({ c }) => extractText(c.url)));
  const readable = tipCandidates
    .map((t, i) => ({ ...t, text: texts[i] }))
    .filter((t): t is typeof t & { text: string } => t.text !== null);

  const tips: SundayTip[] = [];
  const rejected: { id: number; reason: string }[] = [];
  if (readable.length) {
    const drafts = await askJson<{ tips: TipDraft[] }>(
      TIPS_PROMPT,
      readable
        .map(({ kind, c, text }) => `=== ARTIKEL ID ${c.id} | kind: ${kind} | bron: ${c.source} | ${c.title}\n${text.slice(0, TIP_TEXT_CHARS)}`)
        .join("\n\n"),
      TIPS_SCHEMA,
      "tips",
    );
    for (const kind of ["game", "series"] as const) {
      for (const candidate of readable.filter((r) => r.kind === kind)) {
        if (used.has(candidate.c.id)) continue;
        const draft = drafts.tips.find((d) => d.id === candidate.c.id && d.kind === kind);
        if (!draft) {
          rejected.push({ id: candidate.c.id, reason: "no_tip_written" });
          continue;
        }
        const verdict = verifyTip(draft, candidate.text);
        if (!verdict.ok) {
          rejected.push({ id: candidate.c.id, reason: verdict.reason });
          continue;
        }
        used.add(candidate.c.id);
        tips.push({ ...verdict.tip, article_id: candidate.c.id, article_title: candidate.c.title, source: candidate.c.source });
        break;
      }
    }
  }

  const highlightTarget = HIGHLIGHTS + (2 - tips.length);
  for (const { c, motivatie } of weekPicks(selection.highlights)) {
    if (items.filter((i) => i.role === "highlight").length >= highlightTarget) break;
    if (fits(c)) take(c, motivatie, "highlight", null);
  }

  if (items.length + tips.length < 3) throw new Error("Zondag-curator selecteerde te weinig artikelen");

  const saved = await db
    .select({ id: saved_articles.article_id })
    .from(saved_articles)
    .where(gte(saved_articles.saved_at, since))
    .orderBy(desc(saved_articles.saved_at));

  const payload: SundayPayload = { items, tips, saved_ids: saved.map((s) => s.id) };
  const [edition] = await db.insert(editions).values({ kind: "sunday", items_json: JSON.stringify(payload) }).returning();

  const shown = [...items.map((i) => i.id), ...tips.map((t) => t.article_id)];
  await db.update(articles).set({ read: 1 }).where(inArray(articles.id, shown));

  console.log("[sunday.generated]", JSON.stringify({
    edition_id: edition.id,
    week_pool: week.length,
    tip_pool: extra.length,
    removed_by_taste: removedByTaste,
    items: items.map((i) => ({ id: i.id, role: i.role })),
    tips: tips.map((t) => ({ kind: t.kind, name: t.name, article_id: t.article_id })),
    rejected_tips: rejected,
    saved: saved.length,
  }));

  return { edition_id: edition.id, count: items.length + tips.length };
}
