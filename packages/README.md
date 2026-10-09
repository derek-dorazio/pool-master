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
              │ drafts (engines)    │
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

### Draft Module (`modules/drafts/`)

It publishes three operations, `getDraftState`, `submitContestSelection` and
`submitContestEntry` (#481: an entry counts only once its owner submits a complete lineup). It was the last
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

Which selection types the draft room serves is decided in `routes.ts` itself: `TIERED` and
`BUDGET_PICK` reach the roster-selection path; everything else falls through to the
unsupported branch below. `BUDGET_PICK` reaches it with no budget enforced — the spend is
never computed and submission is never gated, so the format is live and ignores its own
defining rule. See #93.

Turn-based selection (snake draft) has no implementation: it was removed in #200 and its
rebuild is deferred to #199. `SelectionType.SNAKE_DRAFT` remains a valid enum value, and a
contest configured with it gets `501 DRAFT_MODE_UNSUPPORTED` from the draft-room endpoints.

The active backend-first pass centers on current PoolMaster web flows and uses sport-specific read models for sport-specific leaderboards. Golf event scoring is stored on event participant round and standing tables; contest entries keep pick pointers and Golf leaderboard rows are computed from those event-side standings.

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
| `db/` | `ports.ts` | 25+ repository port interfaces (hexagonal architecture) |
| `utils/` | `id.ts` | `generateId()` via `crypto.randomUUID()` |

### Key Domain Concepts

| Concept | Values |
|---------|--------|
| **Sports** | GOLF, NFL, NBA, F1, NASCAR, NCAA_BASKETBALL, NCAA_HOCKEY, NCAA_FOOTBALL, TENNIS, HORSE_RACING, SOCCER, NHL, MLB, UFC |
| **Selection Types** | SNAKE_DRAFT, TIERED, BUDGET_PICK, OPEN_SELECTION, PICK_EM, BRACKET_PICK_EM |
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
