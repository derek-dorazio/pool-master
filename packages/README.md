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

It publishes five operations, `getSelectionState`, `selectContestPick` and `unselectContestPick`
(#1259: one pick of one entry, answering with only what changed on it),
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
the schema is skipped (the leaderboard answers 400
`CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID`). A participant score carries a per-family detail
(stroke play: its unplayed rounds). Each family declares the one live-score category it accepts,
or none; the score publisher skips and warns on a batch its event's family does not accept.
Stroke play accepts `GOLF`; head to head accepts `GAME` (#1496), writing a provider's final for
each match linked to its game (`externalGameId`, on the event's own provider) through
`MatchResultService`, the admin's result path, with the teams' provider mappings deciding which
side won. The sync links a game nobody has linked to the one open match of the event whose two
teams it is, so nobody links games by hand. Each match records who set its result
(`resultSource`, #1531): a provider's later final never overwrites an admin's result, and is
logged instead, and the admin's bracket page names the feed a synced result came from. A live
game's score goes on its match too, read-only (`IN_PROGRESS`, no winner), and comes off again if
the provider postpones the game; scoring reads only completed matches. Composite accepts
`STAT_LINE` (#1497): a provider's box scores, each game numbered within the event by the adapter
(each series' Game N is game N), written through `StatLineService` in one write per sync. A star's
provider mapping says whose line it is; a player who is not a mapped star is left out, never
created. A live game's lines are stored `IN_PROGRESS` and a final game's `COMPLETED`, and the sync
rewrites a line an admin corrected. The golf round-score
admin routes refuse an event whose family does not keep golf rounds (422
`EVENT_SCORING_FAMILY_MISMATCH`). The leaderboard response carries the event's `sport`, so the
web resolves the same family for its own presentation (`SCORING_FAMILY_UI`). Two families are
built: `STROKE_PLAY` (golf) and `FINISH_POSITION` (horse racing, #622). Finish position keeps a
race result per field row
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
| BALLDONTLIE (`balldontlie`) | Golf: PGA TOUR. Game scores: NFL weeks and playoffs, the NCAA men's and women's basketball tournaments, the NBA playoffs, Premier League matchweeks, the World Cup's knockout bracket | `BALLDONTLIE_API_KEY`, from Secrets Manager; the binding sets `baseUrl` and the plan's `requestsPerMinute` |
| Mock contest feed | Golf and QA scenarios | Local/QA only |

The BALLDONTLIE adapter was built from the vendor's published OpenAPI document before any account
existed. Its contract tests (`tests/unit/core-api/balldontlie/`) hold every field it reads, and every
request it sends, to a vendored copy of that document; `npm run balldontlie:contract-check` compares
the live document with the copy and, with `BALLDONTLIE_API_KEY` set, runs the adapter against the real
API so any drift shows up as the field that broke.

`requestsPerMinute` paces requests within one process. The API and the background worker each pace
on their own, so together they can go over the plan's limit; the client then waits out the vendor's
429 and retries.

Every bound provider is registered: the default as each of its sports' primary, the others as
secondaries. An event syncs from the provider it is linked to, so the mock and BALLDONTLIE can
both serve golf on QA, and a root admin picks the provider wherever more than one serves a sport.

**Webhooks (#1498):** BALLDONTLIE posts a signed notification to
`POST /api/v1/provider-webhooks/balldontlie` when something happens in a game or tournament. The
route checks the HMAC signature with `BALLDONTLIE_WEBHOOK_SECRET` (from Secrets Manager; unset, it
refuses every delivery) and, for a game or tournament linked to an in-progress event, queues one
`PROVIDER_EVENT_SYNC` job, due a minute out under the event's dedupe key, so a burst shares one
sync. The job runs the same live-score sync the scheduler runs, reading current state over REST,
and the sync history shows it as a `WEBHOOK` run. A game no match is linked to yet syncs every
in-progress event of its league. Notifications for anything else are acknowledged and dropped.

The endpoint subscribes to `BALLDONTLIE_WEBHOOK_EVENT_TYPES` in `balldontlie-webhooks.ts`: each
read league's game start, period end (a soccer match's halftime) and game end, and golf's
tournament start, round start, player round completed and tournament end (never each hole). To set
it up, in the vendor dashboard's Webhooks tab (or its webhook API, which needs All-Access), create
one endpoint at `https://<environment host>/api/v1/provider-webhooks/balldontlie` with those event
types, send its test event (it answers 200 and is dropped), and pass the signing secret it shows
once to Terraform as `balldontlie_webhook_secret` (the `apply-terraform` skill).

**Safety net (#1499):** once the webhook secret is set, notifications carry BALLDONTLIE's live
scores and the live-score sweep only backs them up. It ticks every minute and polls each
BALLDONTLIE event every 15 minutes, or a golf event every 2 minutes while a round is under way
(golf is not notified hole by hole); events of other providers keep the admin's interval. Without
the secret nothing changes. A game or tournament starting also syncs a linked event still
`SCHEDULED` past its start, six minutes out so the lifecycle sweep has moved it in progress first.
A game or tournament ending queues a second, reconciling sync ten minutes later for the provider's
late corrections. Each notification sets `last_provider_notification_at` on the events it is
about, and while one is in play (a golf round under way, or a match in progress) with no
notification for 20 minutes the sweep warns with action `ingestion.providerNotifications.quiet`,
which a CloudWatch alarm sends to the alerts topic. `PROVIDER_WEBHOOK_POLL_SECONDS`,
`PROVIDER_WEBHOOK_ROUND_POLL_SECONDS` and `PROVIDER_WEBHOOK_QUIET_AFTER_SECONDS` override the
three paces (`notified-provider-cadence.ts`).

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
npm run test:coverage:service:unit  # Unit suite with its coverage threshold
```
