# ARCHITECTURE.md — Jasper's Nieuwsreader

> Specificatie voor Claude Code. Dit document beschrijft wat de app doet, hoe die is opgebouwd, en in welke volgorde het gebouwd moet worden.

## Concept

Een persoonlijke nieuwsreader die 1x per dag een feed van maximaal 10 items samenstelt op basis van RSS-bronnen, nieuwsbrieven en een persoonlijk smaakprofiel. De feed is eindig: je leest je 10 items en je bent klaar. Touch grass.

De app is een web-app (Next.js) die voelt als native: schermvullende items, swipe-through, snel, clean, geen afleiding. Eén gebruiker: Jasper.

## Tech stack

| Component | Keuze | Waarom |
|-----------|-------|--------|
| Framework | Next.js 14+ (App Router) | Bekende stack, SSR + API routes |
| Hosting | Vercel | Bekende deploy-flow, gratis tier |
| Database | Turso (libSQL) | SQLite-as-a-service, geen cold-start-verwijdering, gratis tier ruim genoeg |
| ORM | Drizzle ORM | Lichtgewicht, TypeScript-native, werkt goed met Turso |
| AI Curator | Anthropic API (Claude Haiku) | Goedkoop (~€0.01 per curatie), snel, goed genoeg voor selectie |
| RSS parsing | rss-parser (npm) | Simpel, beproefd |
| Styling | Tailwind CSS | Snel, utility-first, past bij de stack |
| Cron / scheduling | Vercel Cron Functions | 1x per dag is ruim binnen hobby-limieten |

## Datamodel (Turso/SQLite)

### sources (bronnen)
```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,           -- website URL
  feed_url TEXT,               -- RSS/Atom feed URL (kan null zijn als nog niet ontdekt)
  category TEXT,               -- tech, series, sport, games, nieuws, wetenschap, cultuur, etc.
  active INTEGER DEFAULT 1,    -- aan/uit toggle
  added_at TEXT DEFAULT (datetime('now'))
);
```

### articles (opgehaalde artikelen, cache)
```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url TEXT,
  published_at TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  category TEXT,               -- overgenomen van source of door AI bepaald
  read INTEGER DEFAULT 0       -- al eerder in een feed getoond?
);
```

### editions (dagelijkse feeds)
```sql
CREATE TABLE editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  items_json TEXT NOT NULL      -- JSON array van geselecteerde article IDs + volgorde
);
```

### article_likes / saved_articles

Likes/dislikes op artikelniveau (`article_likes`) en opgeslagen artikelen (`saved_articles`). Zie `src/db/schema.ts`.

### topics (smaak-onderwerpen)

Specifieke onderwerpen ("Apple: iPhone- en iOS-productnieuws", "Star Trek-series") die Haiku toekent aan artikelen die Jasper liket, dislikt of bewaart (`articles.topic_id`). `manual_weight` (-2 t/m 2) is null zolang het gewicht automatisch uit de signalen volgt. Zie `src/lib/taste.ts`.

> Het oude Smaak-tabblad (`taste_entries`, handmatig media loggen) is in september 2026 verwijderd; het nieuwe Taste-tabblad draait op deze onderwerpen.

## Schermen

### 1. Feed (hoofdscherm) — `/`

Het eerste en belangrijkste scherm. Toont de editie van vandaag.

**Layout:** Schermvullende kaarten, verticaal swipe-through (of scroll-snap). Elke kaart bevat:
- Grote afbeeldingsachtergrond (article image_url, met fallback)
- Titel (groot, leesbaar over afbeelding)
- Korte intro (1-2 regels, description uit RSS)
- Bronlabel (naam van de source)
- Categorie-tag (klein, subtiel)
- Tap/klik opent de originele URL in nieuw tabblad

**Gedrag:**
- Bij eerste bezoek van de dag: genereer editie (als die nog niet bestaat)
- Als editie al bestaat: toon die, geen refresh
- Onderaan de 10 items: "Dat was het voor vandaag" + datum volgende editie
- Geen pull-to-refresh, geen eindeloos laden

**Design-richting:** Clean, redactioneel, magazine-achtig. Donkere overlay op afbeeldingen voor leesbaarheid. Geen kaartjes-met-schaduwengrijs, maar schermvullend en bold. Denk aan het gevoel van de Installer-nieuwsbrief maar dan als app.

### 2. Bronnen — `/bronnen`

**Layout:** Lijst van alle bronnen, gegroepeerd per categorie. Per bron:
- Naam
- URL
- Categorie (dropdown om te wijzigen)
- Aan/uit toggle
- Verwijder-knop

**Toevoegen:** Invulveld bovenaan. Plak een URL (website of RSS-feed). De app probeert automatisch de RSS-feed te ontdekken (via link-tags in de HTML of bekende patronen als /rss, /feed, /atom.xml). Als dat niet lukt, handmatig de feed-URL invoeren.

### 3. Opgeslagen — `/saved` en `/save`

Opgeslagen artikelen uit de feed plus losse links van buiten de app. Links komen binnen via `/save?url=…`:
- plakken op `/save`
- bookmarklet (desktop)
- deelmenu op Android (PWA `share_target` in `manifest.webmanifest`)
- iOS Shortcut die `/save?url=` opent (iOS ondersteunt geen Web Share Target)

Een losse link wordt een `articles`-rij met `read=1` (komt niet in de feed). Onbekende sites krijgen een inactieve bron, zodat opslaan geen abonnement op de hele site wordt.

### 4. Smaak — `/taste`

Per onderwerp een schuif: Never, Less, Neutral, More, Lots.
- Automatisch: likes (+1), bewaard (+2) en dislikes (−1,5) per onderwerp, met een halfwaardetijd van 90 dagen. Twee recente dislikes zonder tegengewicht = Never.
- Verschuift Jasper een schuif, dan is die stand leidend tot hij terugzet naar automatisch.
- Daaronder, alleen-lezen: welke bronnen en categorieën door de duimen voorrang of juist minder krijgen.

Labelen gebeurt direct na een like/dislike/bewaren (op de achtergrond via `after()`), en bij de dagelijkse run en het openen van `/taste` voor alles wat nog geen label heeft.

### Navigatie

Vier tabs onderaan (mobile-first): Feed, Sources, Taste, Saved.

## De Curator (AI-selectie)

### Wanneer draait de curator?
1x per dag, via Vercel Cron (bijv. 06:00). Of on-demand als je de app opent en er nog geen editie is voor vandaag.

### Hoe werkt het?

**Stap 1: Ophalen**
De cron-functie haalt nieuwe artikelen op uit alle actieve bronnen (RSS). Slaat ze op in de articles-tabel. Deduplicatie op URL.

**Stap 2: Filteren**
Verwijder artikelen die al eerder in een editie zijn getoond (read = 1). Verwijder artikelen ouder dan 3 dagen (configureerbaar). Resultaat: een pool van kandidaat-artikelen.

**Stap 2b: Smaak-onderwerpen**
Eén Haiku-call koppelt kandidaten aan de onderwerpen met een gewicht ≠ 0, op het niveau van het onderwerp (een Apple TV+-serie valt niet onder iPhone-nieuws). Kandidaten van een Never-onderwerp gaan eruit. De rest krijgt `smaak=±n` mee in de curator-prompt en telt mee in de sortering. Max 2 items per onderwerp per editie, en de categorie-regels blijven hard, zodat likes de mix niet laten kantelen.

**Stap 3: AI-selectie**
Stuur naar Claude Haiku:
- De kandidaat-artikelen (titel, beschrijving, bron, categorie) — max ~50 stuks
- Het profiel (profile.md, of een samenvatting daarvan)
- De laatste 30 gelikete/gedislikete artikeltitels
- Voorkeurs- en afgewezen bronnen/categorieën (pas bij ≥3 en een duidelijke meerderheid in één richting)
- Per kandidaat het smaak-onderwerp en gewicht
- De feedmix-regels uit het profiel

**Prompt (kern):**
```
Je bent de redacteur van Jasper's persoonlijke nieuwsfeed.

Selecteer precies 10 artikelen uit de kandidatenlijst die samen de beste
dagelijkse feed vormen. Gebruik het profiel en de likes/dislikes om te bepalen
wat relevant is.

> Implementatienotitie: de huidige code vraagt de curator bewust om 15 suggesties en
> reduceert daarna naar 10 items na constraint-enforcement (15 → 10) voor betere variatie.

Regels:
- Nooit meer dan 3 items uit dezelfde categorie
- Altijd minstens 1 Nederlandstalig item
- Minstens 1 longread (>5 min leestijd, schat in op basis van beschrijving)
- Maximaal 2 breaking-news items
- 1 verrassingsitem dat buiten de verwachte interesses valt
- Viral longreads en boekentips zijn altijd welkom

Gewenste mix: [uit profile.md]

Antwoord als JSON array van article IDs in de gewenste volgorde,
met per item een korte motivatie (1 zin) waarom dit item is gekozen.
```

**Stap 4: Opslaan**
Sla de editie op (items_json). Markeer geselecteerde artikelen als read = 1.

### Kosten
Claude Haiku: ~50 artikelen als input (~2000 tokens) + profiel (~1500 tokens) + output (~500 tokens) = ~4000 tokens per dag. Bij Haiku-prijzen is dat minder dan €0.01 per dag, ofwel minder dan €3 per jaar.

## API Routes

```
GET  /api/edition/today     — Haal editie van vandaag op (of genereer als die er niet is)
POST /api/edition/generate   — Forceer nieuwe editie (admin/debug)

GET  /api/sources            — Lijst bronnen
POST /api/sources            — Bron toevoegen (body: { url, name?, category? })
PUT  /api/sources/:id        — Bron wijzigen
DEL  /api/sources/:id        — Bron verwijderen

GET  /api/saved              — Lijst opgeslagen artikelen
POST /api/saved              — Losse link opslaan (body: { url?, text?, title? })
POST /api/articles/:id/like  — Like (body: { liked: true }) of dislike (body: { liked: false })
POST /api/articles/:id/save  — Artikel uit de feed opslaan

PUT  /api/topics/:id          — Smaak-gewicht zetten (body: { weight: -2..2 | null }, null = automatisch)

POST /api/fetch-feeds         — Handmatig feeds ophalen (wordt ook door cron aangeroepen)
```

## RSS Feed Discovery

Als een gebruiker een website-URL invoert (bijv. `https://www.theverge.com`), probeer de feed automatisch te vinden:

1. Fetch de HTML van de URL
2. Zoek naar `<link rel="alternate" type="application/rss+xml">` of `type="application/atom+xml"`
3. Probeer bekende paden: `/rss`, `/feed`, `/atom.xml`, `/rss.xml`, `/feed.xml`, `/index.xml`
4. Als niks werkt: toon de gebruiker een veld om handmatig de feed-URL in te voeren

## Bouwvolgorde

> Stand september 2026: fase 1 en 2 zijn gebouwd. Van fase 4 staat alleen punt 23 (Open Graph) nog open; `public/og.svg` bestaat maar wordt nog nergens gebruikt. Nieuw werk staat onder **Toekomstige uitbreidingen**.

### Fase 1: Fundament
1. Next.js project opzetten met Tailwind
2. Turso database aanmaken en Drizzle ORM configureren
3. Database schema uitrollen (sources, articles, editions, taste_entries)
4. API routes voor sources CRUD
5. Bronnen-scherm bouwen (toevoegen, lijst, aan/uit, verwijderen)
6. RSS feed discovery en opslaan
7. Feed-ophaal functie (/api/fetch-feeds) die alle actieve bronnen pollt
8. Seed de database met bronnen uit profile.md

### Fase 2: De Curator
9. Anthropic API integratie (Claude Haiku)
10. Curator-prompt bouwen met profiel en regels
11. /api/edition/generate endpoint die de AI-selectie uitvoert
12. /api/edition/today endpoint
13. Feed-scherm bouwen (schermvullende kaarten, scroll-snap)
14. "Dat was het voor vandaag" eindscherm
15. Vercel Cron instellen (dagelijks 06:00)

### Fase 3: Smaakprofiel
16. ~~API routes voor taste CRUD~~
17. ~~Smaak-scherm bouwen (toevoegen + tijdlijn)~~
18. ~~Taste entries meesturen naar curator-prompt~~ — gebouwd en in september 2026 weer verwijderd; vervangen door likes/dislikes op artikelen

### Fase 4: Polish
19. Design verfijnen (typografie, kleur, transitions)
20. Fallback-afbeeldingen voor artikelen zonder image
21. Error handling en loading states
22. PWA-setup (manifest, service worker, installeerbaar op telefoon)
23. Open Graph / social preview voor gedeelde artikelen

## Configuratie (environment variables)

```
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=...              — beveiligt de cron endpoint
```

## Toekomstige uitbreidingen (niet nu bouwen)

### Korte termijn (volgorde gedreven door afhankelijkheid)

1. **Categorie-mix instelbaar op het Taste-tabblad** — min/max per categorie (bijv. tech 2–3), standaard de huidige mix. Vervangt de mix-regels die nu dubbel staan (hardcoded prompt in `generate-edition.ts` + `profile.md`) en maakt de categorie-cap in `enforceConstraints` configureerbaar. Aandachtspunt: `articles.category` is de categorie van de bron, dus een serie-stuk op The Verge telt als tech.
2. **Feedback per editie zichtbaar maken** — het Taste-tabblad toont nu de stand per onderwerp; per editie tonen welke items door smaak zijn weggefilterd of voorrang kregen staat alleen nog in de `[edition.generated]`-log (`taste.removed`).
3. **Wekelijkse digest** — aggregaten van saved + liked artikelen van afgelopen week + 1-2 surprise-picks via de bestaande curator-flow. Mail-preview met link naar in-app weekly view.

### Verder weg

- Meerdere edities per dag (ochtend/avond)

### Niet doen

- ~~Gmail API koppeling voor nieuwsbrief-analyse~~ — nieuwsbrieven komen al via RSS binnen, geen tweede pad nodig.
- ~~Taste als tweede feed (media-aanbevelingen via TMDB/IGDB)~~ — het oude Smaak-tabblad is verwijderd (september 2026). Eerdere schets staat in de git-historie van dit bestand.

### Gedaan

- ~~Feedback-loop op feed-items (duimpje omhoog/omlaag)~~ — like + dislike via `article_likes`, met curator-boost/penalty.
- ~~Archief van eerdere edities~~ — `?date=YYYY-MM-DD` met "Previous edition"-link op de EndCard.
- ~~Paywall-constraint in de curator~~ — `sources.is_paywall`-vlag, € indicator op cards en hard cap van 2 paywalled items per editie in `generate-edition.ts`.
- ~~Paywall-detectie per artikel~~ — `articles.is_paywall` (nullable) wordt gevuld door `src/lib/paywall-detect.ts` (JSON-LD `isAccessibleForFree`, `<meta property="article:content_tier">`, host-fallbacks). Detectie loopt mee met edition-generatie op de candidate-pool en kan handmatig via `POST /api/paywall-scan` voor backfill. Effectieve waarde = `coalesce(article.is_paywall, source.is_paywall, 0)`.
- ~~Saved-artikelen verhuizen naar de DB~~ — server-side opslag, voorwaarde voor de wekelijkse digest.
- ~~Reddit API koppeling voor profiel-signalen~~ — ingest via GitHub Actions (`.github/workflows/reddit-ingest.yml` + `src/lib/ingest-reddit.ts`), gepromoot naar de candidate-pool via `src/lib/promote-signals.ts`.
- ~~Bluesky als signaal-bron~~ — `src/lib/ingest-bluesky.ts` + `src/lib/bluesky.ts`, zelfde promote-pad als Reddit.
- ~~Reader-mode voor niet-paywalled artikelen~~ — server-side via `@mozilla/readability` + `linkedom` in `src/lib/extract-article.ts`; HTML wordt met `sanitize-html` op een allowlist gezet (koppen, lijsten, citaten, links, afbeeldingen) en opgemaakt met `@tailwindcss/typography`.
- ~~Losse links opslaan~~ — `/save` + bookmarklet, Android-deelmenu (PWA share target), iOS via Shortcut.
- ~~Smaak per onderwerp (Taste-tabblad)~~ — Haiku labelt gelikete/gedislikete/bewaarde artikelen met een specifiek onderwerp; per onderwerp een automatisch of handmatig gewicht; Never filtert vóór de curator. Bewaarde artikelen tellen nu mee (zwaarder dan een like). Bron- en categoriestraf alleen nog bij ≥3 dislikes en meer dislikes dan likes.
- ~~Likes beïnvloeden kandidaatvolgorde~~ — de score-sortering werd direct door de shuffle overschreven; nu eerst shuffle, dan stabiele sortering op score.
