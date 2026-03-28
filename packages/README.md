# PoolMaster Services

Multi-tenant fantasy sports pool management platform. Independent microservices communicating via domain events over Redis Streams/SQS.

## Architecture

```
                    @poolmaster/shared
        Domain Types | Events | DB Ports | Utils
                         |
    ┌────────────┬───────┼────────┬──────────────┐
    │            │       │        │              │
 core-api   draft-svc  scoring  ingestion   notification
  :3000      :3001      :3002    :3003        :3004
```

All services are Fastify + TypeScript, independently deployable Docker containers.

## Services

### @poolmaster/core-api `:3000`

Main REST API gateway. Manages leagues, contests, entries, and user-facing CRUD operations.

| Module | Endpoints | Description |
|--------|-----------|-------------|
| Leagues | `/api/v1/leagues` | CRUD, settings, invitations, member management |
| Contests | `/api/v1/contests` | CRUD, pool management, standings, results |
| Participants | `/api/v1/participants` | Search, CRUD, season records, provider mappings |
| Contest Pools | `/api/v1/contests/:id/pool` | Pool lifecycle, pricing, tiers, draft search |
| History | `/api/v1/contests/:id/history/*`, `/api/v1/leagues/:id/history/*` | Standings, timelines, replays, records, rivalries, analytics |
| Search | `/api/v1/search/participants`, `/api/v1/search/discover/*` | Full-text search, league/contest discovery |
| Compliance | `/api/v1/account/*` | Age verify, consent, data export, deletion, self-exclusion, enforcement |
| Billing | `/api/v1/billing/*` | Entitlements, plan tiers, usage (free tier — all pass) |
| Templates | `/api/v1/templates` | Contest template CRUD |

**Infrastructure:** PostgreSQL via Prisma ORM (50+ models), Redis for caching, DynamoDB for event data.

**Key files:**
- `prisma/schema.prisma` — Full database schema
- `src/core/tenant-context.ts` — Multi-tenant extraction from `x-tenant-id` header
- `src/modules/` — Domain modules (leagues, contests, participants, history, search, compliance)

---

### @poolmaster/draft-service `:3001`

Manages all selection/draft mechanics. Pure-function engines that take state + input and return new state (immutable).

| Engine | Description | Contest Types |
|--------|-------------|---------------|
| `SnakeDraftEngine` | Turn-based exclusive selection with snake order | NFL/NBA/MLB fantasy |
| `TieredPickEngine` | Pick N from defined tier groups (non-exclusive) | Golf majors, NHL playoffs |
| `BudgetPickEngine` | Build roster within cost budget (non-exclusive) | F1 season-long, DFS |
| `SurvivorEngine` | Knockout-style picks with strikes/buybacks | NFL Survivor, NCAA |
| `PickEmEngine` | Period-by-period outcome predictions | NFL pick'em, confidence pools |
| `BracketEngine` | Full bracket submission with round multipliers | March Madness, NHL playoffs |

**Key files:**
- `src/engine/snake-draft-engine.ts` — `validatePick()`, `applyPick()`, `resolveAutoPick()`
- `src/engine/draft-session-manager.ts` — Session state transitions (PENDING → LIVE → PAUSED → COMPLETE)
- `src/engine/draft-order.ts` — Draft order generation
- `src/engine/pick-order.ts` — Round/pick position calculation
- `src/modules/drafts/routes.ts` — REST endpoints (start, pick, pause, resume, extend)

**Auto-pick policies:** `QUEUE_THEN_BEST`, `BEST_AVAILABLE`, `RANDOM`

---

### @poolmaster/scoring-service `:3002`

Calculates scores from stat events using configurable rule engines. No sport logic is hard-coded — all scoring is driven by `ScoringConfig` objects stored as JSONB per contest.

#### Core Engine (`src/engine/`)

| Function | Purpose |
|----------|---------|
| `evaluateStatRules()` | Points from player stats (with unit_size and conditions) |
| `evaluatePositionRules()` | Points from finish position (exact, range, LAST) |
| `evaluateBonusRules()` | Conditional bonus triggers (e.g. 300+ passing yards) |
| `evaluatePenaltyRules()` | Negative point penalties (e.g. spots lost in F1) |
| `applyMultiplierRules()` | Captain/MVP/double-down slot multipliers |
| `handleDNF()` | Did-not-finish: ZERO, EXCLUDE, LAST_PLACE, PENALTY, MISSED_CUT_SCORE |
| `applyCountingMethod()` | ALL, BEST_N, DROP_LOWEST_N (with lower_is_better for stroke play) |
| `scoreParticipant()` | Full breakdown for one participant |
| `scoreEntry()` | Score a roster with counting method applied |

#### Specialized Scoring Engines

| Engine | File | Description |
|--------|------|-------------|
| Bracket | `bracket-scoring.ts` | Round-based points, upset bonus (SEED_DIFFERENCE / SEED_MULTIPLIER) |
| Rotisserie | `rotisserie-scoring.ts` | Category rankings across entries with tie averaging |
| Head-to-Head | `head-to-head-scoring.ts` | Weekly matchups, W/L/T records, win% standings |
| Stroke Play | `stroke-play-scoring.ts` | Lower strokes wins, missed cut penalties, Best-N counting |

#### Tiebreaker Chain (`tiebreaker.ts`)

Resolves ties via primary → secondary → tertiary chain: `CHAMPIONSHIP_SCORE_PREDICTION`, `MOST_CORRECT_PICKS`, `EARLIER_SUBMISSION`, `BEST_SINGLE_SCORE`, `MOST_BIRDIES`, `LOWEST_ROUND`, `HEAD_TO_HEAD_RECORD`, `MOST_WINS`, `COIN_FLIP`, `COMMISSIONER_DECISION`.

#### Stat Schema Validation (`stat-schemas.ts`)

Validates that `stat_key` references in a config are valid for the sport. Covers 11 sports: NFL, NBA, GOLF, F1, NASCAR, TENNIS, SOCCER, HORSE_RACING, NCAA_BASKETBALL, MLB, UFC.

#### Templates (`src/templates/`)

16 pre-built scoring configs across 9 sports. Commissioner selects a template, then customizes any field.

| Sport | Templates |
|-------|-----------|
| NFL | `nfl_standard_nonppr`, `nfl_ppr`, `nfl_half_ppr` |
| Golf | `golf_dfs_standard`, `golf_stroke_pick6_use4` |
| F1 | `f1_dfs_captain` |
| NASCAR | `nascar_dfs_place_diff` |
| NCAA | `ncaa_bracket_standard`, `ncaa_bracket_upset_bonus`, `ncaa_bracket_seed_multiplier`, `ncaa_bracket_flat` |
| NBA | `nba_points_league` |
| Tennis | `tennis_slam_dfs` |
| Horse Racing | `horse_racing_position` |
| Soccer/EPL | `epl_dfs_standard` |

**API Routes:**
- `GET /scoring/templates` — List all templates
- `GET /scoring/templates/:key` — Get template config
- `POST /scoring/config/validate` — Validate a config (Zod + stat key check)

---

### @poolmaster/ingestion-worker `:3003`

Polls external sports data providers and publishes `StatEvent` messages to the bus.

| Adapter | Sport(s) | API Key Required |
|---------|----------|-----------------|
| PGA Tour (ESPN Golf) | Golf | No |
| OpenF1 | F1 | No |
| ESPN | NFL, NBA, MLB, NHL, NCAA | No |
| The Odds API | All (odds/pricing) | Yes (free tier: 500 req/mo) |

**Key files:**
- `src/core/provider-interface.ts` — `SportDataProvider` adapter interface
- `src/core/provider-registry.ts` — PRIMARY/FALLBACK per sport with auto-failover
- `src/core/ingestion-scheduler.ts` — Scheduled polling (6hr schedule, 12hr participants, 24hr rankings)
- `src/adapters/` — One adapter per provider

**API Routes:**
- `GET /health` — Health + provider status
- `GET /providers` — Registered adapters
- `POST /sync/:sport` — Manual schedule sync
- `POST /scores/:sport/:eventId` — Poll live scores
- `POST /odds/:sport` — Fetch odds data

---

### @poolmaster/notification-service `:3004`

Full notification pipeline: events → preferences → templates → channels (push, email, in-app).

| Component | Description |
|-----------|-------------|
| NotificationDispatcher | Central orchestration — resolve recipients, check prefs, render, deliver |
| InAppChannel | Notification centre (Prisma) |
| EmailChannel | SMTP (Mailpit dev) / SES (LocalStack dev / real prod) |
| PushChannel | APNs + FCM (push-mock dev / real prod) |
| RateLimiter | Per-user push/hr, email/day limits, dedup, collapse windows |
| EventGrouper | Buffers high-frequency events into grouped summaries |
| ScheduledRunner | Polls for due scheduled notifications |
| WeeklyDigest | League recap emails |

**API Routes:**
- `GET /api/v1/notifications` — Notification centre (list, unread count, mark read)
- `GET/PUT /api/v1/notifications/preferences` — Per-category per-channel preferences
- `POST /api/v1/devices` — Push device registration
- `POST /api/v1/notifications/dispatch` — Send a notification event
- `POST /api/v1/notifications/announce` — Commissioner announcement (bypass prefs)
- `POST /api/v1/notifications/schedule` — Schedule future notification
- `POST /api/v1/notifications/digest/:leagueId` — Send weekly digest
- `GET /api/v1/notifications/analytics` — Delivery rates, suppression stats
- `POST /api/v1/test/email` — Test email (dev only)
- `POST /api/v1/test/push` — Test push (dev only)

---

## Shared Package (`@poolmaster/shared`)

| Layer | Files | Purpose |
|-------|-------|---------|
| `domain/` | `enums.ts`, `types.ts`, `scoring-config.ts`, `entitlements.ts` | 40+ domain interfaces, 20+ enum types, Zod-validated scoring config |
| `db/` | `ports.ts` | 25+ repository port interfaces (hexagonal architecture) |
| `events/` | `base.ts`, `draft.ts`, `scoring.ts`, `contest.ts`, `notification.ts`, `event-bus.ts` | Domain events + event bus |
| `utils/` | `id.ts` | `generateId()` via `crypto.randomUUID()` |

### Supported Sports

GOLF, NFL, NBA, F1, NASCAR, NCAA_BASKETBALL, NCAA_HOCKEY, NCAA_FOOTBALL, TENNIS, HORSE_RACING, SOCCER, NHL, MLB, UFC

### Selection Types

`SNAKE_DRAFT`, `TIERED`, `BUDGET_PICK`, `OPEN_SELECTION`, `PICK_EM`, `BRACKET_PICK_EM`

### Contest Lifecycle

`DRAFT` → `OPEN` → `DRAFTING` → `LOCKED` → `ACTIVE` → `COMPLETED` / `CANCELLED`

---

## Development

```bash
npm install              # Install all workspace dependencies
npm run dev              # Start all services (turbo --parallel)
npm run build            # Build all packages
npm run typecheck        # TypeScript check all packages
npm run test:unit        # Run unit tests
npm run test             # Run all tests
```

**Requirements:** Node.js >= 20.0.0

## Test Coverage

Unit tests: scoring engine, templates, tiebreakers, stat validation, historical data validation, notification template renderer, rate limiter, preference service, event grouper.

Smoke tests: `npm run test:smoke:api` — hits all 5 service health endpoints + key routes.
