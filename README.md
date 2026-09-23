# newsreader

Persoonlijke nieuwsreader voor Jasper. Eén gebruiker, geen auth. Stelt 1x per dag een feed van maximaal 10 items samen op basis van RSS-bronnen, signalen uit Reddit en Bluesky, een persoonlijk smaakprofiel en likes/dislikes op artikelen. De feed is eindig: lees je 10 items en je bent klaar.

## Stack

- Next.js (App Router) op Vercel
- Turso (libSQL) + Drizzle ORM
- Tailwind CSS
- Anthropic API (Claude Haiku) als curator
- `@mozilla/readability` voor server-side reader-mode
- Reddit/Bluesky ingest via GitHub Actions

Zie [`ARCHITECTURE.md`](./ARCHITECTURE.md) voor de volledige specificatie en [`CLAUDE.md`](./CLAUDE.md) voor projectconventies.

## Lokaal draaien

```bash
npm install
cp .env.example .env.local   # vul TURSO_*, ANTHROPIC_API_KEY, CRON_SECRET in
npm run db:migrate
npm run dev
```

## Database

```bash
npm run db:generate   # genereer SQL-migraties op basis van src/db/schema.ts
npm run db:migrate    # rol migraties uit naar Turso
npm run db:studio     # open Drizzle Studio
```

## Schermen

- `/` — Feed (editie van vandaag, schermvullende kaarten)
- `/sources` — RSS-bronnen beheren
- `/saved` — Opgeslagen artikelen, plus instructies voor opslaan vanuit browser/telefoon
- `/save?url=…` — Losse link opslaan (doel van bookmarklet, Android-deelmenu en iOS Shortcut)
- `/article/:id` — Reader-mode

## Environment variables

```
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=...
```
