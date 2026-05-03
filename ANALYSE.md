# Projectanalyse (2026-05-03)

## 1) Feed-samenstelling vs. `ARCHITECTURE.md`

### Wat klopt
- Dagelijkse editie wordt inderdaad opgebouwd via een curator-flow: kandidaten uit `articles`, profiel uit `profile.md`, plus `taste_entries`, daarna opslag in `editions` en markering `read=1`.
- Er is filtering op recente en ongelezen artikelen (3 dagen venster + `read=0`).
- De feed-UI toont schermvullende kaarten met bron, categorie, beschrijving en eindkaart “Dat was het voor vandaag”.

### Afwijkingen / risico's
- **Selectiegrootte mismatch**: architectuur zegt “selecteer precies 10”, code vraagt AI om **15** en snijdt daarna naar 10.
- **Per-bron limiet inconsistent**: architectuur/prompt stuurt op max 2 per bron; code heeft ook `MAX_PER_SOURCE = 3` in kandidaat-opbouw.
- **“Minstens 1 NL item” is hardcoded op specifieke bronnen** (NOS/NRC/FTM) in plaats van taal-detectie; kwetsbaar als die bronnen uitstaan of ontbreken.
- **Alleen bron-diversiteit wordt nagedwongen in code** (`enforceConstraints`), categorie/longread/breaking/verrassing worden niet post-validated.
- **Niet-deterministische shuffle** (`Math.random`) maakt uitkomsten lastig reproduceerbaar/debugbaar.

## 2) Doet tabblad “Smaak” functioneel iets?

### Ja, functioneel aanwezig
- `/smaak` heeft werkende CRUD-lite: lijst ophalen, toevoegen, verwijderen.
- Toegevoegde entries worden gebruikt in curator-context via `fetchTasteContext()` en opgenomen in prompt.

### Gaten t.o.v. architectuur
- **Rating ontbreekt in UI** (wel kolom in DB).
- Type-taxonomie wijkt af (`podcast`, `overig`, `spel`) versus architectuur (`series/film/boek/game/muziek`).
- “Tijdlijn” toont relatieve tijd (`vandaag`, `gisteren`) i.p.v. expliciete datum zoals gespecificeerd.

## 3) Zijn alle features uit `ARCHITECTURE.md` doorgevoerd?

### Grotendeels aanwezig
- Bronnenbeheer met categorie, toggle, delete en feed-discovery.
- API-routes voor sources, taste, fetch, edition today/generate.
- Feed met eindig karakter en eindscherm.
- Cron endpoints aanwezig.

### Nog niet (volledig) doorgevoerd
- **PWA setup** (manifest/service worker/installable) ontbreekt.
- **Open Graph/social preview** niet zichtbaar geconfigureerd.
- **Error/loading polish** deels aanwezig, maar niet overal consistent.
- **Smaak UX-spec** (rating + specifieke types) incompleet.
- **Curator-regels niet hard gegarandeerd** behalve deels bronlimiet.

## 4) Concrete verbetervoorstellen (geprioriteerd)

1. **Maak curatieregels afdwingbaar in code**
   - Voeg post-selection validator toe op categorieplafond, NL-item, longread, breaking-cap en serendipity-flag.
   - Vervang “best effort” door “repair pass” (aanvullen/vervangen tot constraints kloppen).

2. **Breng prompt + constants in lijn met architectuur**
   - Vraag AI direct om 10 items.
   - Harmoniseer bronlimiet (2 of 3), documenteer één waarheid.

3. **Smaak-tabblad afmaken volgens spec**
   - Voeg rating-input (1-10) toe en sla op.
   - Normaliseer types (`series/film/boek/game/muziek`) en migreer bestaande waarden.
   - Toon absolute datum naast relatieve tijd.

4. **Observability & reproduceerbaarheid**
   - Structured logging met edition-id, kandidaatcount, constraint-violations.
   - Seeded/random-stable ordering of idempotente selectie voor debug-runs.

5. **Polish / productkwaliteit**
   - Voeg PWA-manifest + service worker toe.
   - Verrijk metadata/OG image.
   - Voeg eenvoudige e2e smoke-tests toe voor: sources CRUD, taste CRUD, edition generation.
