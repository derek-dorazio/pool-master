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

| Module | Status | Endpoints |
|--------|--------|-----------|
| Leagues | Active | `GET /api/v1/leagues`, `POST /api/v1/leagues` |
| Contests | Stubbed | — |
| Auth | Stubbed | — |

**Infrastructure:** PostgreSQL via Prisma ORM (20+ models), Redis for caching.

**Key files:**
- `src/core/tenant-context.ts` — Multi-tenant extraction from `x-tenant-id` header
- `src/core/error-handler.ts` — Global error handling
- `src/modules/leagues/service.ts` — League business logic
- `prisma/schema.prisma` — Full database schema (Tenant, User, League, Contest, Entry, Pick, Draft, Standing, Result)

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

Polls external data providers and publishes `StatEvent` messages to the bus. **Status: Stubbed.**

TODO: Provider adapters (ESPN, TheOdds), polling scheduler, stat normalization.

---

### @poolmaster/notification-service `:3004`

Sends notifications (email, SMS, push) triggered by domain events. **Status: Stubbed.**

TODO: Event consumer, notification channels, user preference management.

---

## Shared Package (`@poolmaster/shared`)

| Layer | Files | Purpose |
|-------|-------|---------|
| `domain/` | `enums.ts`, `types.ts`, `scoring-config.ts` | 20+ domain interfaces, 14 enum types, Zod-validated scoring config |
| `db/` | `ports.ts` | 17 repository port interfaces (hexagonal architecture) |
| `events/` | `base.ts`, `draft.ts`, `scoring.ts`, `contest.ts` | Domain events: `StatEvent`, `ScoreUpdatedEvent`, `DraftPickMadeEvent`, `DraftCompletedEvent` |
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

179 tests across 5 test suites covering scoring engine, templates, tiebreakers, stat validation, historical data validation (NFL, Golf, NCAA, NBA, F1, NASCAR, Tennis, Horse Racing, EPL).
