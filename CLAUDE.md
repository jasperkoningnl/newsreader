# CLAUDE.md — Newsreader projectconventies

## Project

Persoonlijke nieuwsreader voor Jasper. Eén gebruiker. Geen auth. Next.js App Router op Vercel, SQLite via Turso, Drizzle ORM, Tailwind CSS, Anthropic API (Claude Haiku als curator).

## Structuur

```
src/
  app/                  # Next.js App Router
    api/                # API route handlers
      sources/          # CRUD voor bronnen
      edition/          # Dagelijkse feed endpoints
      saved/            # Opgeslagen artikelen + losse links opslaan
      fetch-feeds/      # RSS-ophaal endpoint (ook cron-target)
    sources/            # /sources pagina
    saved/              # /saved pagina
    save/               # /save?url=… (bookmarklet, share target)
    page.tsx            # Feed (hoofdscherm)
  db/
    index.ts            # Drizzle client (Turso/libSQL)
    schema.ts           # Alle tabel-definities
drizzle/                # Gegenereerde SQL-migraties (drizzle-kit)
drizzle.config.ts       # Drizzle Kit configuratie
profile.md              # Jasper's smaakprofiel — input voor de AI-curator
ARCHITECTURE.md         # Volledige specificatie van de app
```

## Technische keuzes

- **Next.js App Router**: alle pagina's onder `src/app/`, API routes als `route.ts`-bestanden
- **Turso + Drizzle ORM**: schema in `src/db/schema.ts`, migraties via `drizzle-kit`
- **Tailwind CSS**: utility-first, geen component-library, geen custom CSS tenzij noodzakelijk
- **TypeScript strict**: geen `any`, typen uit Drizzle `$inferSelect` / `$inferInsert`

## Codeconventies

- Geen comments tenzij de *waarom* niet vanzelf spreekt
- Geen docstrings of multi-line commentblokken
- Exporteer typen vanuit `schema.ts` (`Source`, `NewSource`, etc.)
- API-handlers: altijd `try/catch`, altijd `console.error` bij exceptions, altijd gestructureerde JSON-errors
- Valideer alleen aan de systeemgrens (user input, externe APIs) — vertrouw interne code
- Geen onnodige abstractions: 3 vergelijkbare regels is beter dan een premature helper

## Environment variables

```
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=...
```

Zet in `.env.local` voor lokale ontwikkeling (staat in `.gitignore`).

## Database

Schema: `sources`, `articles`, `editions`, `article_likes`, `saved_articles`, `link_signals` — zie `src/db/schema.ts` en `ARCHITECTURE.md`.

Migraties aanmaken:

```bash
npm run db:generate   # Genereer SQL-migraties op basis van schema
npm run db:migrate    # Rol migraties uit naar Turso
npm run db:studio     # Open Drizzle Studio (lokale DB-viewer)
```

Migraties draaien automatisch via `.github/workflows/db-migrate.yml` zodra er iets in `drizzle/` op `main` landt (handmatig: Actions → DB Migrate → Run workflow).

## Bouwvolgorde

Zie `ARCHITECTURE.md` → sectie **Bouwvolgorde**. We zijn in **Fase 1**.

Volgende stap na de huidige setup: bronnen-scherm bouwen (`/bronnen`), RSS feed discovery, feed-ophaal functie.

## Design-richting

Schermvullend, bold, magazine-achtig. Geen kaartjes-met-schaduw. Donkere overlay op afbeeldingen. Mobile-first. Drie tabs onderaan: Feed, Sources, Saved.
