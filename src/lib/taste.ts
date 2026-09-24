import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { article_likes, articles, saved_articles, sources, topics } from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { cleanHtmlText } from "./html-text";
import { normalizeCategory } from "./category-mix";

const client = new Anthropic();
const MODEL = "claude-haiku-4-5";

const SIGNAL = { like: 1, save: 2, dislike: -1.5 };
const HALF_LIFE_DAYS = 90;
const LABEL_BATCH = 40;
const MAX_LABELS_PER_RUN = 120;

export type TopicState = {
  id: number;
  label: string;
  manual_weight: number | null;
  auto_weight: number;
  weight: number;
  likes: number;
  dislikes: number;
  saves: number;
  last_signal_at: string | null;
};

export type PreferenceContext = {
  preferredSources: Set<string>;
  preferredTopics: Set<string>;
  dislikedSources: Set<string>;
  dislikedTopics: Set<string>;
};

function parseDbDate(value: string | null): number {
  if (!value) return Date.now();
  const ms = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function decay(at: string | null): number {
  const ageDays = Math.max(0, (Date.now() - parseDbDate(at)) / 86400000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function autoWeight(score: number): number {
  if (score <= -2.5) return -2;
  if (score < -0.5) return -1;
  if (score >= 6) return 2;
  if (score >= 2) return 1;
  return 0;
}

function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

async function askJson(system: string, content: string, maxTokens: number): Promise<unknown> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
  });
  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Haiku gaf geen JSON-array: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

function parsePairs(raw: unknown): { id: number; topic: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const { id, topic } = r as { id?: unknown; topic?: unknown };
    if (typeof id !== "number" || typeof topic !== "string" || !topic.trim()) return [];
    return [{ id, topic: topic.trim() }];
  });
}

const LABEL_PROMPT = `Je labelt nieuwsartikelen met één onderwerp, zodat een persoonlijke nieuwsreader leert wat de lezer wel en niet wil lezen.

Regels voor een label:
- Nederlands, 2 tot 6 woorden.
- Specifiek op het niveau waarop iemand iets wel of niet wil lezen: het soort product, het soort nieuws, de specifieke serie/game/sport. Niet op het niveau van een heel bedrijf of een brede categorie.
  Goed: "Apple: iPhone- en iOS-productnieuws", "Apple: bedrijf, rechtszaken en beleid", "Star Trek-series", "Ajax en Eredivisie", "AI-tools en agents", "Gadget-reviews".
  Fout: "Apple", "Tech", "Nieuws", "Entertainment".
- Een serie die bij een streamingdienst van een techbedrijf draait, gaat over die serie, niet over het bedrijf.
- Gebruik een BESTAAND label letterlijk als het artikel daar duidelijk onder valt. Maak alleen een nieuw label als geen bestaand label past.

Antwoord uitsluitend met een JSON-array: [{"id": <artikel-id>, "topic": "<label>"}, ...] met precies één regel per artikel.`;

export async function labelArticles(ids: number[]): Promise<number> {
  const unique = [...new Set(ids)];
  if (!unique.length) return 0;

  const rows = await db
    .select({ id: articles.id, title: articles.title, description: articles.description, source: sources.name })
    .from(articles)
    .leftJoin(sources, eq(articles.source_id, sources.id))
    .where(and(inArray(articles.id, unique), isNull(articles.topic_id)));
  if (!rows.length) return 0;

  const existing = await db.select({ id: topics.id, label: topics.label }).from(topics);
  const byLabel = new Map(existing.map((t) => [t.label.toLowerCase(), t.id]));

  const list = rows
    .map((r) => `ID ${r.id} | ${r.source ?? "onbekende bron"} | ${cleanHtmlText(r.title)}\n  ${r.description ? cleanHtmlText(r.description).slice(0, 240) : "(geen beschrijving)"}`)
    .join("\n\n");
  const labels = existing.length ? existing.map((t) => `- ${t.label}`).join("\n") : "(nog geen)";

  const pairs = parsePairs(
    await askJson(LABEL_PROMPT, `Bestaande labels:\n${labels}\n\nArtikelen:\n${list}`, 2000)
  );

  const known = new Set(rows.map((r) => r.id));
  let labeled = 0;
  for (const { id, topic } of pairs) {
    if (!known.has(id)) continue;
    const label = normalizeLabel(topic);
    let topicId = byLabel.get(label.toLowerCase());
    if (!topicId) {
      await db.insert(topics).values({ label }).onConflictDoNothing({ target: topics.label });
      const [row] = await db.select({ id: topics.id }).from(topics).where(eq(topics.label, label)).limit(1);
      if (!row) continue;
      topicId = row.id;
      byLabel.set(label.toLowerCase(), topicId);
    }
    await db.update(articles).set({ topic_id: topicId }).where(eq(articles.id, id));
    labeled++;
  }
  return labeled;
}

async function pendingArticleIds(limit: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ id: articles.id })
    .from(articles)
    .leftJoin(article_likes, eq(article_likes.article_id, articles.id))
    .leftJoin(saved_articles, eq(saved_articles.article_id, articles.id))
    .where(and(isNull(articles.topic_id), or(isNotNull(article_likes.id), isNotNull(saved_articles.id))))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function countUnlabeled(): Promise<number> {
  return (await pendingArticleIds(MAX_LABELS_PER_RUN)).length;
}

export async function labelPendingArticles(): Promise<number> {
  const ids = await pendingArticleIds(MAX_LABELS_PER_RUN);
  let labeled = 0;
  for (let i = 0; i < ids.length; i += LABEL_BATCH) {
    labeled += await labelArticles(ids.slice(i, i + LABEL_BATCH));
  }
  return labeled;
}

export async function labelInBackground(articleId: number): Promise<void> {
  try {
    await labelArticles([articleId]);
  } catch (error) {
    console.error("[taste.label] failed", articleId, error);
  }
}

export async function fetchTopicStates(): Promise<TopicState[]> {
  const [all, likes, saves] = await Promise.all([
    db.select().from(topics),
    db
      .select({ topic_id: articles.topic_id, liked: article_likes.liked, at: article_likes.created_at })
      .from(article_likes)
      .innerJoin(articles, eq(article_likes.article_id, articles.id))
      .where(isNotNull(articles.topic_id)),
    db
      .select({ topic_id: articles.topic_id, at: saved_articles.saved_at })
      .from(saved_articles)
      .innerJoin(articles, eq(saved_articles.article_id, articles.id))
      .where(isNotNull(articles.topic_id)),
  ]);

  const stats = new Map<number, { score: number; likes: number; dislikes: number; saves: number; last: string | null }>();
  const bump = (topicId: number | null, delta: number, key: "likes" | "dislikes" | "saves", at: string | null) => {
    if (topicId === null) return;
    const s = stats.get(topicId) ?? { score: 0, likes: 0, dislikes: 0, saves: 0, last: null };
    s.score += delta * decay(at);
    s[key]++;
    if (at && (!s.last || at > s.last)) s.last = at;
    stats.set(topicId, s);
  };
  for (const l of likes) {
    if (l.liked === 0) bump(l.topic_id, SIGNAL.dislike, "dislikes", l.at);
    else bump(l.topic_id, SIGNAL.like, "likes", l.at);
  }
  for (const s of saves) bump(s.topic_id, SIGNAL.save, "saves", s.at);

  return all.map((t) => {
    const s = stats.get(t.id);
    const auto = autoWeight(s?.score ?? 0);
    return {
      id: t.id,
      label: t.label,
      manual_weight: t.manual_weight,
      auto_weight: auto,
      weight: t.manual_weight ?? auto,
      likes: s?.likes ?? 0,
      dislikes: s?.dislikes ?? 0,
      saves: s?.saves ?? 0,
      last_signal_at: s?.last ?? null,
    };
  });
}

const CLASSIFY_PROMPT = `Je krijgt kandidaat-artikelen voor een persoonlijke nieuwsfeed, een lijst categorieën en een lijst onderwerpen.
Geef per artikel:

1. "category": de categorie waar het artikel inhoudelijk onder valt, ongeacht de bron. Een recensie van een serie op een techsite is "series", niet "tech".
   - Kies uitsluitend uit de gegeven categorieën, letterlijk.
   - "news" is algemeen actueel nieuws. Kies een specifiekere categorie alleen als het stuk daar duidelijk over gaat.
2. "topic" (alleen als het past): het onderwerp waar het artikel DUIDELIJK onder valt, op het specifieke niveau van dat onderwerp.
   - "Apple: iPhone- en iOS-productnieuws" omvat een iPhone-review of een iOS-update, maar niet een rechtszaak tegen Apple en niet een serie op Apple TV+.
   - Twijfel je, of past geen onderwerp: laat "topic" weg.
   - Gebruik de onderwerpen letterlijk zoals gegeven.

Antwoord uitsluitend met een JSON-array met precies één regel per artikel: [{"id": <artikel-id>, "category": "<categorie>", "topic": "<onderwerp>"}, ...].`;

export type CandidateClassification = { topics: Map<number, TopicState>; categories: Map<number, string> };

export async function classifyCandidates(
  candidates: { id: number; title: string; description: string | null; source: string }[],
  weighted: TopicState[],
  categories: string[]
): Promise<CandidateClassification> {
  const result: CandidateClassification = { topics: new Map(), categories: new Map() };
  if (!candidates.length || (!weighted.length && !categories.length)) return result;

  const byLabel = new Map(weighted.map((t) => [t.label.toLowerCase(), t]));
  const allowed = new Set(categories);
  const list = candidates
    .map((c) => `ID ${c.id} | ${c.source} | ${c.title}\n  ${c.description?.slice(0, 200) ?? "(geen beschrijving)"}`)
    .join("\n\n");
  const raw = await askJson(
    CLASSIFY_PROMPT,
    `Categorieën:\n${categories.map((c) => `- ${c}`).join("\n") || "(geen: laat \"category\" weg)"}\n\nOnderwerpen:\n${weighted.map((t) => `- ${t.label}`).join("\n") || "(geen)"}\n\nArtikelen:\n${list}`,
    8000
  );
  if (!Array.isArray(raw)) return result;

  const ids = new Set(candidates.map((c) => c.id));
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const { id, category, topic } = r as { id?: unknown; category?: unknown; topic?: unknown };
    if (typeof id !== "number" || !ids.has(id)) continue;
    if (typeof category === "string" && allowed.has(category.toLowerCase().trim())) {
      result.categories.set(id, category.toLowerCase().trim());
    }
    const state = typeof topic === "string" ? byLabel.get(normalizeLabel(topic).toLowerCase()) : undefined;
    if (state) result.topics.set(id, state);
  }
  return result;
}

const SOURCE_LIKE_THRESHOLD = 3;
const SOURCE_DISLIKE_THRESHOLD = 3;

export async function fetchPreferenceContext(): Promise<PreferenceContext> {
  const rows = await db
    .select({ source: sources.name, topic: article_likes.topic, liked: article_likes.liked })
    .from(article_likes)
    .leftJoin(sources, eq(article_likes.source_id, sources.id));

  const counts = { src: new Map<string, [number, number]>(), top: new Map<string, [number, number]>() };
  const add = (map: Map<string, [number, number]>, key: string, liked: boolean) => {
    const c = map.get(key) ?? [0, 0];
    c[liked ? 0 : 1]++;
    map.set(key, c);
  };
  for (const row of rows) {
    const liked = row.liked !== 0;
    const source = (row.source ?? "").trim();
    if (source) add(counts.src, source, liked);
    add(counts.top, normalizeCategory(row.topic), liked);
  }

  // Source and category are coarse: only act on them when the balance is clearly one-sided,
  // so a few disliked Apple pieces don't sink a whole site or all of tech.
  const pick = (map: Map<string, [number, number]>, positive: boolean) =>
    new Set(
      [...map.entries()]
        .filter(([, [likes, dislikes]]) =>
          positive ? likes > SOURCE_LIKE_THRESHOLD && likes > dislikes : dislikes >= SOURCE_DISLIKE_THRESHOLD && dislikes > likes
        )
        .map(([k]) => k)
    );

  return {
    preferredSources: pick(counts.src, true),
    preferredTopics: pick(counts.top, true),
    dislikedSources: pick(counts.src, false),
    dislikedTopics: pick(counts.top, false),
  };
}
