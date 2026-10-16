# PoolMaster Backend

Modular monolith — all backend modules run in a single Fastify process on port 3000, communicating via in-process domain events.

## Architecture

```
                    @poolmaster/shared
        Domain Types | DTOs | DB Ports | Utils
                         |
              ┌──────────┴──────────┐
              │   core-api :3000    │
              ├─────────────────────┤
              │ auth / leagues      │──→ PostgreSQL (Prisma)
              │ contests / events   │
              │ selections (engines)│
              │ golf standings      │
              │ email               │──→ SMTP / SES
              │ ingestion           │──→ provider adapters
              │ platform            │
              └─────────────────────┘
```

## Modules (packages/core-api/src/modules/)

### Domain Modules

**Deliberately not listed here.** A hand-maintained table of modules, prefixes and
responsibilities went stale faster than anyone updated it. When it was removed, **5 of its 11
rows were wrong**: `admin`, `config` and `history` named modules that no longer exist, and
`contest-management`, `squads` and `config` named a prefix other than the one registered. **12
modules were missing entirely** — `client-logs`, `contest-config-templates`,
`contest-entry-picks`, `email`, `golf`, `platform`, `sport-catalog`, `sport-leagues`, `sports`,
`team-invitations`, `version`, and `users`, the object `plans/145` slice 1 was entirely about
(that plan was deleted with its epic #201; retrieve via
`git show 020de6bf:plans/145-one-object-one-operation-set.md`).
Per `plans/142`, *an empty or generic README is worse than no README, because it looks like
documentation*; a wrong one is worse still (that plan was deleted when #140 closed; retrieve via
`git show 44b0a7a:plans/142-durable-product-documentation.md`).

Where to look instead, in order of authority:

- **`rules/architecture-rules.md` §5 *Project Structure and Layer Boundaries*** — what each
  layer holds, what it is forbidden to hold, which files belong in `modules/<object>/`, and
  the suite that proves each boundary.
- **The Fastify route registrations** — the only real truth about prefixes.
  `packages/shared/generated/openapi.json` is generated from them and `npm run api:check`
  fails if it drifts.
- **`ls packages/core-api/src/modules/`** — the module list, which cannot be stale.

`core-api` has no package README, deliberately: #140 closed without adding one.

### Draft Module (`modules/selections/`)

It publishes four operations, `getSelectionState`, `submitContestSelection`,
`submitContestEntry` (#481: an entry counts only once its owner submits a complete lineup) and
`runContestDraw` (#601: a random-draw contest's commissioner deals every entry its picks). It was the last
module holding route plumbing, actor resolution, direct `prisma.` calls, the selection rules
and response mapping in a single `routes.ts`; #346 extracted the service layer, so the
module now carries the ordinary layering. The file set each module should end up with is
`rules/architecture-rules.md` §5 *Project Structure and Layer Boundaries*; `ls` the module
for what it has today.

This section previously described two "pure-function engines", `TieredPickEngine` and
`BudgetPickEngine` (listed twice each). Neither was ever imported by `packages/core-api/src`,
and both were deleted in #323: the live rules in `routes.ts` are a superset of what they
checked, return typed error codes rather than free-text reasons, and need no pre-assembled
in-memory snapshot of every tier, entry and pick. Do not reintroduce that shape — pure rule
functions belong as helpers inside the service #324 creates.

Each selection type has its engine in an exhaustive registry keyed by `SelectionType`
(`selection-engines/registry.ts`): `TIERED`, `BUDGET_PICK` and `RANDOM_DRAW`, and the type
system refuses a value with no engine. The random-draw engine refuses every selection; its picks
come from the draw (`dealRandomDraw`, a seeded and replayable round-robin deal), which
`ContestEntryPickService.recordDraw` writes in one transaction with the `contest_draws` row.

Each scoring family has its module in an exhaustive registry keyed by `ScoringFamily`
(`modules/scoring-families/registry.ts`). Contest scoring, settlement, the settled-standing
read, the leaderboard detail blocks and live-score writes reach it through the event's sport
definition. A family scores the field per contest, given that contest's scoring settings: the
participant scoring rule's `config`, typed per scoring definition by
`PARTICIPANT_SCORING_SETTINGS_SCHEMAS` (golf's to-par total takes none) and read back through
that schema, so settlement scores inside its per-contest loop and a contest whose settings fail
the schema is skipped (the leaderboard answers 400 `CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID`).
A participant score carries a per-family detail (stroke play: its unplayed rounds). Each family
declares the one live-score category it accepts, or none; the score publisher skips and warns on
a batch its event's family does not accept. The golf round-score admin routes refuse an event
whose family does not keep golf rounds (422 `EVENT_SCORING_FAMILY_MISMATCH`). The leaderboard
response carries the event's `sport`, so the web resolves the same family for its own
presentation (`SCORING_FAMILY_UI`). Two families are built: `STROKE_PLAY` (golf) and
`FINISH_POSITION` (horse racing, #622). Finish position keeps a race result per field row
(`SportEventParticipantRaceResult`); an entry's settled points, like golf's to-par total, are `ContestEntryStanding.totalScore`;
the admin enters the finishing order through `previewEventRaceResults` and
`applyEventRaceResults` (`scoring-families/finish-position/race-result-service.ts`), and a
runner scores its contest's points table value at its place once the result is official. It takes
no live scores. A contest's scoring settings ride in its configuration's optional `scoring`, a
template can carry a preset there, and a definition with no default settings (the points table)
must be sent or come from the template.

Turn-based selection (snake draft) has no implementation: it was removed in #200 and its
rebuild is deferred to #199. Its `SNAKE_DRAFT` enum value was deleted with the other unbuilt
catalog values in #605; it returns with the engine that serves it.

The active backend-first pass centers on current PoolMaster web flows and uses sport-specific read models for sport-specific leaderboards. Golf event scoring is stored on event participant round and standing tables; contest entries keep pick pointers and contest leaderboard rows are computed from those event-side standings.

### Ingestion Module (`modules/ingestion/`)

Polls configured sports data providers, upserts normalized event data, and stores provider sync diagnostics for operator review.

| Adapter | Sport(s) | API Key |
|---------|----------|---------|
| ESPN | NFL, NBA, MLB, NHL, NCAA | Free |
| OpenF1 | F1 | Free |
| Mock contest feed | Golf and QA scenarios | Local/QA only |

**Routes:** root-admin sync is event-scoped: `POST /api/v1/ingestion/sports/:sport/events/:eventId/sync` runs the event field (`EVENTPARTICIPANTS`) and live-score (`EVENTLIVESCORES`) feeds. Scheduled ingestion uses the internal scheduler directly for the same two feeds. There is no sport-level sync and no scheduled schedule or results pull (#126); events are created and linked by the root admin, and `getUpcomingEvents` is read only on demand.

---

## Shared Package (`@poolmaster/shared`)

| Layer | Files | Purpose |
|-------|-------|---------|
| `domain/` | `enums.ts`, `types.ts`, `contest-scoring.ts`, `contest-management-types.ts` | Domain interfaces, enum types, and the participant scoring definitions (direction, unit, format) |
| `domain/sports/` | `registry.ts`, `golf.ts`, `horse-racing.ts` | The sport registry: one `SportDefinition` per sport (scoring family, selection types, default rounds and tier layout, vocabulary, round labels). See `rules/architecture-rules.md` §4 *Sport extension* |
| `db/` | `ports.ts` | 25+ repository port interfaces (hexagonal architecture) |
| `utils/` | `id.ts` | `generateId()` via `crypto.randomUUID()` |

### Key Domain Concepts

| Concept | Values |
|---------|--------|
| **Sports** | GOLF (a Postgres enum since #603; a sport is added with the code that serves it) |
| **Selection Types** | TIERED, BUDGET_PICK, RANDOM_DRAW |
| **Contest Lifecycle** | DRAFT → OPEN → ACTIVE → COMPLETED |

---

## Infrastructure

| Component | Description |
|-----------|-------------|
| **PostgreSQL 16** | Primary database via Prisma ORM (50+ models) |

## Standalone Support Packages

| Package | Purpose |
|---------|---------|
| `mock-contest-feed-provider` | Local/QA-only contest feed simulator for event fields, odds, and live-score scenarios |

---

## Development

```bash
npm install              # Install all workspace dependencies
npm run dev:start        # Start Docker + migrations + seed + all services
npm run dev              # Start services only (Docker already running)
npm run build            # Build all packages
npm run typecheck        # TypeScript check
npm run test:unit        # Run service unit tests
npm run test:coverage:service:fresh  # Full backend validation lane
```
