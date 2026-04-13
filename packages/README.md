# PoolMaster Backend

Modular monolith — all backend modules run in a single Fastify process on port 3000, communicating via in-process domain events.

## Architecture

```
                    @poolmaster/shared
        Domain Types | Events | DB Ports | Utils
                         |
              ┌──────────┴──────────┐
              │   core-api :3000    │
              ├─────────────────────┤
              │ auth / leagues      │──→ PostgreSQL (Prisma)
              │ contests / standings│
              │ drafts (engines)    │
              │ scoring / prizes    │
              │ notifications       │──→ SES / APNs / FCM
              │ ingestion           │──→ ESPN / OpenF1 / PGA
              │ admin / consent     │
              └─────────────────────┘
```

## Modules (packages/core-api/src/modules/)

### Domain Modules

| Module | Prefix | Responsibility |
|--------|--------|----------------|
| **auth** | `/api/v1/auth` | Register, login, refresh, logout, OAuth |
| **leagues** | `/api/v1/leagues` | League creation, summaries, member directories, activity state, invite ownership |
| **invitations** | `/api/v1/invitations` | Invitation preview and invite acceptance flows |
| **contests** | `/api/v1/contests` | Contest CRUD, contest summaries, entries, standings, overrides, recalculation |
| **contest-management** | `/api/v1/contests/:contestId/manage` | Commissioner-owned contest configuration and management workflows |
| **participants** | `/api/v1/participants` | Search, CRUD, season records, provider mappings |
| **standings** | `/api/v1/contests/:id/standings` | Leaderboards, rankings |
| **history** | `/api/v1/` | Completed contest summaries, standings, payouts, roster history, league/member results |
| **account-consent** | `/api/v1/account` | Consent and age-affirmation capture |
| **events** | `/api/v1/events` | Provider event records, schedules, statuses, and event lookup APIs |
| **admin** | `/api/v1/admin` | Platform admin operations for health, provider ingestion, migrations, audit, and contest administration |
| **config** | `/api/v1/config` | Public configuration and poll-interval guidance |
| **notifications** | `/api/v1/notifications` | In-app notification reads, preferences, and delivery-oriented support APIs |
| **squads** | `/api/v1/squads` | Squad roster and contest-entry support services |

### Draft Module (`modules/drafts/`)

Pure-function engines that take state + input and return new state (immutable).

| Engine | Description | Contest Types |
|--------|-------------|---------------|
| `SnakeDraftEngine` | Turn-based exclusive selection with snake order | NFL/NBA/MLB fantasy |
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Golf majors, NHL playoffs |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | F1 season-long, DFS |
| `SnakeDraftEngine` | Turn-based exclusive selection with snake order | Snake-draft roster contests |
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Tiered roster contests |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | Budget roster contests |

The active backend-first pass centers on the current PoolMaster web flows while retaining the broader contest/scoring backbone behind the same monolith.

### Scoring Module (`modules/scoring/`)

Contest scoring is driven by configured participant scoring rules, entry aggregation rules, and prize definitions owned by `ContestConfiguration`.

| Component | Purpose |
|-----------|---------|
| `participant-scoring-definition-registry.ts` | Maps scoring definition ids to concrete participant scoring functions |
| `entry-aggregation-function-registry.ts` | Maps aggregation ids to entry-total aggregation functions |
| `contest-scoring-recalculation-service.ts` | Rebuilds participant score events, entry totals, standings, and prize awards |
| `contest-entry-scoring-result-service.ts` | Persists participant score totals, score events, prize awards, and entry summary fields |
| `stat-event-consumer.ts` | Treats incoming stat updates as contest recalculation triggers |
| `standings-rollup.ts` | Recomputes standings on `ContestEntry.standingsPosition` |

Launch scoring definitions currently implemented on this branch:
- `GOLF_RELATIVE_TO_PAR_TOTAL`
- `TEAM_WIN_POINTS`
- `ROUND_MULTIPLIER`
- `SEED_DIFFERENTIAL_BONUS`

Launch entry aggregation rules currently implemented on this branch:
- `SUM_ALL_ENTRIES`
- `SUM_TOP_N_ENTRIES`

### Notification Module (`modules/notifications/`)

Current active surface: in-app notification reads, preference updates, and delivery-support plumbing retained in the monolith.

| Component | Description |
|-----------|-------------|
| `dispatcher.ts` | Resolve recipients, check preferences, render template, deliver |
| `in-app-channel.ts` | Notification centre (Prisma) |
| `email-channel.ts` | SMTP (Mailpit dev) / SES (prod) |
| `push-channel.ts` | APNs + FCM (push-mock dev / real prod) |
| `rate-limiter.ts` | Per-user push/hr, email/day limits |
| `event-grouper.ts` | Buffers high-frequency events into grouped summaries |
| `scheduled-runner.ts` | Polls for due scheduled notifications |
| `weekly-digest.ts` | League recap emails |

**Routes:** `GET /api/v1/notifications`, `PUT /api/v1/notifications/preferences`, `POST /api/v1/devices`, `POST /api/v1/notifications/dispatch`, `POST /api/v1/notifications/announce`

### Ingestion Module (`modules/ingestion/`)

Polls external sports data providers and publishes `stat.updated` events to the in-process EventBus.

| Adapter | Sport(s) | API Key |
|---------|----------|---------|
| ESPN | NFL, NBA, MLB, NHL, NCAA | Free |
| PGA Tour | Golf | Free |
| OpenF1 | F1 | Free |
| The Odds API | All (odds/pricing) | Yes (free tier: 500 req/mo) |

**Routes:** `GET /api/v1/ingestion/providers`, `POST /api/v1/ingestion/sync/:sport`, `POST /api/v1/ingestion/scores/:sport/:eventId`

---

## Shared Package (`@poolmaster/shared`)

| Layer | Files | Purpose |
|-------|-------|---------|
| `domain/` | `enums.ts`, `types.ts`, `scoring-config.ts`, `entitlements.ts` | 40+ domain interfaces, 20+ enum types, Zod-validated scoring config |
| `db/` | `ports.ts` | 25+ repository port interfaces (hexagonal architecture) |
| `events/` | `base.ts`, `draft.ts`, `scoring.ts`, `contest.ts`, `notification.ts`, `event-bus.ts` | Domain events + in-process EventBus |
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
| **In-process EventBus** | Domain-event fan-out inside the monolith |
| **DynamoDB** | Deferred/high-volume event support |
| **In-process EventBus** | `stat.updated` → scoring → `score.updated` → `standings.updated` |

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
