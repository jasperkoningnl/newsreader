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

## 5) Haalbaarheidscheck: like-functie die curator prioriteit geeft

### Gevraagde regels
- Bij **meer dan 3 likes van 1 bron** -> bron krijgt extra voorrang in de curator.
- Bij **meer dan 3 likes van 1 onderwerp** -> onderwerp/categorie krijgt extra voorrang in de curator.

### Huidige situatie (impact op haalbaarheid)
- Er is al een `liked`-concept, maar alleen op `taste_entries` (handmatige smaakitems), niet op nieuwsartikelen/sources zelf.
- `generateEdition()` heeft al een duidelijk selectiestroom waarin een extra prioriteringsstap logisch in te voegen is (voor of tijdens kandidatenselectie).
- Categorie bestaat al op `articles.category`; bronnaam is bekend via join met `sources`.

### Conclusie haalbaarheid
- **Technisch haalbaar op korte termijn** (1-2 iteraties) zonder grote refactor.
- Grootste ontwerpkeuze: likes vastleggen op **article-niveau** (aanrader) of afleiden uit `taste_entries` (minder nauwkeurig voor nieuwsbron/onderwerp).

### Aanbevolen implementatie-aanpak
1. **Datamodel uitbreiden (minimaal, veilig)**
   - Voeg `article_likes` tabel toe met minimaal: `id`, `article_id`, `liked` (0/1), `created_at`.
   - Voor snelle aggregatie eventueel ook `source_id` en genormaliseerde `topic` opslaan (denormalisatie voor performance).

2. **API + UI voor liken in feed**
   - Endpoint: `POST /api/articles/:id/like` (toggle of expliciet like/unlike).
   - Voeg like-knop toe op feed cards zodat gedrag direct op gelezen content wordt vastgelegd.

3. **Voorkeursprofiel afleiden**
   - Maak helper in `src/lib/` die likes aggregeert:
     - `sourceLikes[source] = count(liked=1)`
     - `topicLikes[category] = count(liked=1)`
   - Filter op `count > 3` om “voorrang”-sets te bepalen.

4. **Curator beïnvloeden op 2 niveaus**
   - **Prompt-niveau**: voeg expliciet toe welke bronnen/onderwerpen voorrang hebben.
   - **Deterministische ranking-niveau (aanrader)**: score kandidaten vóór `runCurator()`:
     - +2 als bron in preferred-sources
     - +2 als categorie in preferred-topics
     - daarna shufflen binnen gelijke score voor variatie
   - Zo is effect meetbaar en niet alleen afhankelijk van LLM-interpretatie.

5. **Constraint-compatibiliteit bewaken**
   - Huidige caps blijven gelden (`SOURCE_LIMIT`, categorieplafond, breaking-limiet).
   - “Voorrang” betekent hogere kans, niet onbeperkt doorbreken van mixregels.

6. **Observability / validatie**
   - Log per editie: welke preferred sources/topics actief waren en hoeveel geselecteerde items daaraan voldeden.
   - Voeg tests toe voor drempelgedrag:
     - precies 3 likes -> geen voorrang
     - 4 likes -> wel voorrang
     - voorrang mag niet leiden tot overtreding van harde limieten.

### Risico's en mitigaties
- **Cold start**: weinig likes in begin -> fallback naar huidige curatorflow.
- **Categorie-ruis**: inconsistent `articles.category` -> normaliseren met kleine mapping (`ai` -> `tech`, etc.).
- **Like-spam**: idem-potente like endpoint + unique constraint per user/session/article (afhankelijk van auth-model).

### MVP-scope (realistisch)
- DB migratie + like endpoint + feed-like knop + eenvoudige voorkeursscore vóór curator.
- Geen personalisatie-per-meerdere-gebruikers nodig als app nu single-user is.
