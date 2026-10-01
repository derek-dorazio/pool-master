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

| Module | Prefix | Responsibility |
|--------|--------|----------------|
| **auth** | `/api/v1/auth` | Register, login, refresh, logout, OAuth |
| **leagues** | `/api/v1/leagues` | League creation, summaries, member directories, activity state, invite ownership |
| **invitations** | `/api/v1/invitations` | Invitation preview and invite acceptance flows |
| **contests** | `/api/v1/contests` | Contest CRUD, contest summaries, entries, picks, and sport-specific leaderboard reads |
| **contest-management** | `/api/v1/contests/:contestId/manage` | Commissioner-owned contest configuration and management workflows |
| **participants** | `/api/v1/participants` | Search, CRUD, season records, provider mappings |
| **history** | `/api/v1/` | Historical contest reads and roster history; final Golf settlement results land through the Golf-specific scoring model |
| **events** | `/api/v1/events` | Provider event records, schedules, statuses, and event lookup APIs |
| **admin** | `/api/v1/admin` | Platform admin operations for health, provider ingestion, migrations, audit, and contest administration |
| **config** | `/api/v1/config` | Public configuration and poll-interval guidance |
| **squads** | `/api/v1/squads` | Squad roster and contest-entry support services |

### Draft Module (`modules/drafts/`)

Pure-function engines that take state + input and return new state (immutable).

| Engine | Description | Contest Types |
|--------|-------------|---------------|
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Golf majors, NHL playoffs |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | F1 season-long, DFS |
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Tiered roster contests |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | Budget roster contests |

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
