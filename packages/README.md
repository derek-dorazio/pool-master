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
              │ contests / standings│──→ Redis (cache)
              │ drafts (engines)    │
              │ scoring (engines)   │──→ In-memory ScoreStore
              │ notifications       │──→ SES / APNs / FCM
              │ ingestion           │──→ ESPN / OpenF1 / PGA
              │ admin / billing     │
              └─────────────────────┘
```

## Modules (packages/core-api/src/modules/)

### Domain Modules

| Module | Prefix | Responsibility |
|--------|--------|----------------|
| **auth** | `/api/v1/auth` | Register, login, refresh, logout, OAuth |
| **leagues** | `/api/v1/leagues` | CRUD, members, invitations, dashboard, audit |
| **contests** | `/api/v1/contests` | CRUD, pool management, overrides, templates |
| **participants** | `/api/v1/participants` | Search, CRUD, season records, provider mappings |
| **standings** | `/api/v1/contests/:id/standings` | Leaderboards, rankings |
| **history** | `/api/v1/` | Standings history, timelines, records, rivalries, analytics |
| **search** | `/api/v1/search` | Full-text search, league/contest discovery |
| **social** | `/api/v1/social` | League feed, contest chat, direct messages, recaps, share cards; DTO-backed contract with persistence follow-up tracked in plans |
| **compliance** | `/api/v1/account` | Age verify, consent, data export, deletion, self-exclusion; live contract with any persistence follow-up tracked in plans |
| **billing** | `/api/v1/billing` | Entitlements, plan tiers, usage (free tier); live contract with paid-plan persistence still tracked in plans |
| **admin** | `/api/v1/admin` | Platform admin operations; contract-aligned operational tools with remaining persistence follow-up tracked in plans |
| **config** | `/api/v1/config` | Public configuration |

### Draft Module (`modules/drafts/`)

Pure-function engines that take state + input and return new state (immutable).

| Engine | Description | Contest Types |
|--------|-------------|---------------|
| `SnakeDraftEngine` | Turn-based exclusive selection with snake order | NFL/NBA/MLB fantasy |
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Golf majors, NHL playoffs |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | F1 season-long, DFS |
| `SurvivorEngine` | Knockout-style picks with strikes/buybacks | NFL Survivor, NCAA |
| `PickEmEngine` | Period-by-period outcome predictions | NFL pick'em, confidence pools |
| `BracketEngine` | Full bracket submission with round multipliers | March Madness, NHL playoffs |

**Routes:** `GET /api/v1/drafts/templates`, `GET /api/v1/drafts/templates/:id`

### Scoring Module (`modules/scoring/`)

Configurable rule engines driven by `ScoringConfig` JSONB — no sport logic hard-coded.

| Component | Purpose |
|-----------|---------|
| `scoring-engine.ts` | Core: stat rules, position rules, bonuses, penalties, multipliers, counting |
| `bracket-scoring.ts` | Round-based points, upset bonuses |
| `rotisserie-scoring.ts` | Category rankings across entries |
| `head-to-head-scoring.ts` | Weekly matchups, W/L/T records |
| `stroke-play-scoring.ts` | Lower strokes wins, missed cut penalties |
| `tiebreaker.ts` | 10-method tiebreaker chain |
| `stat-schemas.ts` | Validates stat keys per sport (11 sports) |
| `stat-event-consumer.ts` | Subscribes to `stat.updated` events, scores affected entries |
| `standings-rollup.ts` | Periodic rollup (30s) — assigns ranks, detects changes |

**16 templates** across 9 sports (NFL, Golf, F1, NASCAR, NCAA, NBA, Tennis, Horse Racing, Soccer).

**Routes:** `GET /api/v1/scoring/templates`, `POST /api/v1/scoring/config/validate`, `GET /api/v1/scoring/contests/:id/leaderboard`

### Notification Module (`modules/notifications/`)

Full notification pipeline: events → preferences → templates → channels.

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
| **Redis 7** | Caching, future message bus |
| **DynamoDB** | High-volume event data (future) |
| **In-process EventBus** | `stat.updated` → scoring → `score.updated` → `standings.updated` |

---

## Development

```bash
npm install              # Install all workspace dependencies
npm run dev:start        # Start Docker + migrations + seed + all services
npm run dev              # Start services only (Docker already running)
npm run build            # Build all packages
npm run typecheck        # TypeScript check
npm run test:unit        # Run 468 unit tests
```
