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
documentation*; a wrong one is worse still.

Where to look instead, in order of authority:

- **`docs/LAYERS.md`** — what each layer of a module holds, which files belong in
  `modules/<object>/`, and where the boundaries are still soft. Current and maintained.
- **The Fastify route registrations** — the only real truth about prefixes.
  `packages/shared/generated/openapi.json` is generated from them and `npm run api:check`
  fails if it drifts.
- **`ls packages/core-api/src/modules/`** — the module list, which cannot be stale.

#140 decides whether `core-api` gets a real package README; `plans/142` notes it has none
today, and did not count this file as one.

### Draft Module (`modules/drafts/`)

One file: `routes.ts`. It publishes two operations, `getDraftState` and
`submitContestSelection`, and holds everything behind them — route plumbing, actor and
commissioner resolution, 13 direct `prisma.` calls, the selection rules and the response
mapping. There is no service, handler, mapper or port layer here; this is the one module
`plans/145` slice 3 did not reach (plan deleted with epic #201; retrieve via
`git show 020de6bf:plans/145-one-object-one-operation-set.md`).
**#198** tracks the extraction — #324 was closed as a duplicate of it — and
`docs/LAYERS.md` §2.4 states the file set it should end up with.

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

**Routes:** root-admin sync operations are exposed through `POST /api/v1/ingestion/sports/:sport/sync` and `POST /api/v1/ingestion/sports/:sport/events/:eventId/sync`; scheduled ingestion uses the internal scheduler directly.

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
| **Contest Lifecycle** | DRAFT → OPEN → DRAFTING → LOCKED → ACTIVE → COMPLETED / CANCELLED |

---

## Infrastructure

| Component | Description |
|-----------|-------------|
| **PostgreSQL 16** | Primary database via Prisma ORM (50+ models) |

## Standalone Support Packages

| Package | Purpose |
|---------|---------|
| `push-mock-server` | Local APNs/FCM capture service for push integration testing |
| `mock-contest-feed-provider` | Local/QA-only contest feed simulator for odds, rankings, and results scenarios |

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
