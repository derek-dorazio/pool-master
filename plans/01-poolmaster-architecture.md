# PoolMaster Platform — Architecture & Build Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

---

## Plan Index

| # | Document | Coverage |
|---|---|---|
| 01 | [Architecture & Build Plan](01-poolmaster-architecture.md) | Architecture, domain model, tech stack, service topology, build phases |
| 02 | [Draft Configuration](02-poolmaster-draft-config.md) | Snake draft, tiered pick, budget pick, pick'em, survivor mechanics |
| 02a | [Contest Structures](02a-poolmaster-contest-structures.md) | All v1 contest types per sport — source of truth for supported formats |
| 03 | [Scoring Rules](03-poolmaster-scoring-rules.md) | Sport-specific scoring configs, stat schemas, scoring engine flow |
| 04 | [Contest History](04-poolmaster-history.md) | Contest history, league history, records, rivalries, analytics |
| 05 | [Participant Data](05-poolmaster-participant-data.md) | Participant profiles, pricing, tiers, pools, deduplication, search |
| 06 | [Sports Data Integration](06-poolmaster-sports-data-integration.md) | Provider adapters, ingestion pipelines, polling, outage handling |
| 07 | [Billing & Subscriptions](07-poolmaster-billing-subscription.md) | Plan tiers, entitlements, Stripe, trials, dunning, revenue analytics |
| 08 | [Commissioner Tooling](08-poolmaster-commissioner-tooling.md) | League/contest wizards, overrides, dashboard, templates, audit trail |
| 09 | [Notifications & Alerts](09-poolmaster-notifications-alerts.md) | Event taxonomy, channels, preferences, templates, scheduling |
| 10 | [Social & Communication](10-poolmaster-social-communication.md) | Activity feed, chat, DMs, recaps, share-to-social, moderation |
| 11 | [Admin Dashboard](11-poolmaster-admin-dashboard.md) | Tenant/user management, feature flags, platform health, support tools |
| 12 | [Mobile Client](12-poolmaster-mobile-client.md) | Native iOS (SwiftUI) + Android (Compose), offline caching, push, deep linking |
| 13 | [Search & Discovery](13-poolmaster-search-discovery.md) | Draft search, pool setup filtering, public league discovery |
| 14 | [Localisation & i18n](14-poolmaster-localisation-i18n.md) | Timezone handling, multi-currency, number formatting, translation |
| 15 | [Responsible Gaming](15-poolmaster-responsible-gaming.md) | Age verification, geographic restrictions, GDPR/CCPA, data retention |

### Client Plans

| Subfolder | Scope |
|---|---|
| [webapp/](webapp/) | React web app — 14 plan files (auth, dashboard, leagues, contests, draft room, etc.) |
| [ios-app/](ios-app/) | Native iOS (Swift/SwiftUI) — 9 plan files, 51 tasks (auth, navigation, draft room, push, social) |

### Testing Plans

| Subfolder | Scope |
|---|---|
| [testing/](testing/) | Smoke test suites — API-only (Vitest) and UI (Playwright), 38 tasks across 9 phases |

---

## 1. Vision & Scope

A multi-tenant SaaS platform where groups of friends (or colleagues) create leagues, configure contests across any sport, draft squads, and compete on live leaderboards. The platform is sport-agnostic by design — golf, tennis, F1, NCAA brackets, horse racing, and anything else are all first-class citizens configured through a flexible domain model rather than hard-coded sport logic.

**Target clients:** Web (React + shadcn/ui), iOS (Swift + SwiftUI), Android (Kotlin + Jetpack Compose)
**Backend:** Node.js + Fastify + TypeScript
**Deployment:** Docker on AWS ECS Fargate or EKS
**Scale:** Multi-tenant SaaS, horizontally scalable per service

---

## 2. Domain Model

This is the heart of the system. Every other decision flows from getting this right.

### Tenant & Identity Layer

```
Tenant
  ├── id, name, slug, plan_tier, settings
  └── → Users (many-to-many via TenantMembership)

User
  ├── id, email, display_name, auth_provider, auth_id
  └── global identity, scoped to tenants via membership
```

### League Layer

```
League
  ├── id, tenant_id, name, description, created_by
  ├── settings: JSONB (invite policy, visibility, etc.)
  └── → LeagueMemberships (role: COMMISSIONER | MANAGER | VIEWER)

LeagueMembership
  ├── league_id, user_id, role, joined_at
  └── → Teams (a member can have one team per contest)
```

### Sport & Participant Layer

```
Sport
  ├── id, name (GOLF, TENNIS, F1, NCAA_BASKETBALL, HORSE_RACING...)
  ├── participant_type: INDIVIDUAL | TEAM
  └── stat_schema: JSONB  ← defines what stats are tracked per sport

Season
  ├── id, sport_id, tenant_id, name, year, start_date, end_date
  └── → Contests

Participant          ← sport-agnostic: could be a golfer, driver, horse, college team
  ├── id, sport_id, name, external_id (from data provider)
  ├── metadata: JSONB  (world ranking, team affiliation, etc.)
  └── → ParticipantSeasonStats (in NoSQL)
```

### Contest Layer

```
Contest
  ├── id, league_id, season_id, name, status
  ├── contest_type: SINGLE_EVENT | SEASON_LONG
  ├── selection_type: SNAKE_DRAFT | TIERED | BUDGET_PICK | OPEN_SELECTION | PICK_EM | BRACKET_PICK_EM
  ├── scoring_engine: ADVANCEMENT | STAT_ACCUMULATION | STROKE_PLAY | POSITION | BRACKET | FIGHT_RESULT | CUMULATIVE
  ├── is_exclusive: boolean
  ├── scoring_stops_on_elimination: boolean
  ├── starts_at, ends_at, lock_at
  └── scoring_rules: JSONB  ← round values, stat weights, position points, etc.

SelectionConfig
  ├── id, contest_id, selection_type
  ├── draft_mode: LIVE | ASYNC (for SNAKE_DRAFT)
  ├── rounds, time_per_pick (for SNAKE_DRAFT)
  ├── tier_config: JSONB (for TIERED)
  ├── budget, pricing_method, roster_size (for BUDGET_PICK)
  ├── pick_count (for OPEN_SELECTION: "Pick 8")
  ├── survivor_style: LIVE_PICK | LOCKED_PICK (for PICK_EM survivor)
  ├── picks_per_period, one_entity_per_season, strikes, buybacks (survivor)
  ├── round_values: JSONB (for BRACKET_PICK_EM)
  ├── best_ball_n, missed_cut_penalty (for STROKE_PLAY golf)
  └── is_exclusive: boolean

ContestParticipantPool
  ├── contest_id, participant_id
  ├── cost (for BUDGET_PICK)
  ├── tier, tier_assignment_method (for TIERED)
  └── is_available: boolean
```

### Entry & Picks Layer

```
ContestEntry       ← one per league member per contest (replaces "Team")
  ├── id, contest_id, league_membership_id, name
  ├── total_score, rank
  └── is_eliminated: boolean (for survivor contests)

RosterPick         ← squad selection picks (snake, tiered, budget)
  ├── entry_id, participant_id
  ├── draft_round, draft_pick_number, picked_at
  └── auto_picked: boolean

ContestPick        ← survivor / pick'em picks (one per period)
  ├── entry_id, contest_id, participant_id
  ├── period, period_label, picked_at
  ├── is_correct: boolean (resolved after period ends)
  └── confidence_weight, multiplier (optional)

BracketPrediction  ← bracket pick'em (all predictions at once)
  ├── entry_id, contest_id, submitted_at
  ├── predictions: JSONB (round, match, predicted_winner, series_length)
  └── tiebreaker_value
```

### Draft Session (Snake Draft Only)

```
DraftSession
  ├── id, contest_id, status: PENDING | LIVE | PAUSED | COMPLETE
  ├── current_pick_number, current_entry_id (on the clock)
  ├── started_at, pick_deadline (for async)
  └── → DraftPicks

DraftPick
  ├── id, draft_session_id, entry_id, participant_id
  ├── pick_number, round, pick_in_round
  └── picked_at, auto_picked: boolean
```

### Scoring Layer (split across SQL + NoSQL)

```
SQL — summary & history:
ContestStanding
  ├── contest_id, team_id, rank, total_points
  └── last_updated_at

ContestResult
  ├── contest_id, team_id, final_rank, points, prize (if configured)
  └── → historical record after contest closes

NoSQL — high-volume, event-driven:
ParticipantEventStats     ← per participant, per contest event (e.g. each golf round)
  ├── partition: contest_id#participant_id
  ├── sort: event_timestamp
  └── stats: { score, position, strokes, laps_led, ... } ← flexible per sport

TeamContestPoints         ← computed points per team, per scoring event
  ├── partition: contest_id#team_id
  ├── sort: event_timestamp
  └── { points_earned, running_total, breakdown: [...] }
```

---

## 3. Technical Architecture

### Service Topology

```
                        ┌─────────────────────────────────┐
Clients                 │   Web (React)  iOS  Android      │
(web, iOS, Android)     └────────────┬────────────────────-┘
                                     │ HTTPS + WSS
                        ┌────────────▼────────────────────┐
                        │        API Gateway / ALB         │
                        └────────────┬────────────────────-┘
                                     │
              ┌──────────────────────┼────────────────────┐
              │                      │                     │
   ┌──────────▼──────┐   ┌──────────▼──────┐  ┌──────────▼──────┐
   │   Core API      │   │  Draft Service  │  │  Scoring Service │
   │ (Node/Fastify)  │   │ (Node/Fastify)  │  │  (Node/Fastify)  │
   │                 │   │  + WebSocket    │  │                  │
   └──────────┬──────┘   └──────────┬──────┘  └──────────┬──────┘
              │                      │                     │
              └──────────────────────┼────────────────────┘
                                     │
              ┌──────────────────────┼────────────────────┐
              │                      │                     │
   ┌──────────▼──────┐   ┌──────────▼──────┐  ┌──────────▼──────┐
   │   Relational DB │   │  Message Bus     │  │   NoSQL DB       │
   │ (RDS Postgres   │   │  (SQS + SNS or  │  │ (DynamoDB or     │
   │  or MySQL)      │   │   EventBridge)  │  │  MongoDB Atlas)  │
   └─────────────────┘   └─────────────────┘  └─────────────────┘
                                     │
                        ┌────────────▼────────────────────┐
                        │     Stats Ingestion Worker       │
                        │  (polls/receives sport data APIs) │
                        └─────────────────────────────────-┘
```

### Services

| Service | Responsibility |
|---|---|
| **Core API** | Auth, leagues, memberships, contests, entries, picks, standings reads |
| **Draft Service** | Draft session lifecycle, live/async pick orchestration, WebSocket room per draft |
| **Scoring Service** | Consumes stat events, applies scoring rules, writes to NoSQL, updates SQL standings |
| **Stats Ingestion Worker** | Polls or receives webhooks from sport data providers, normalizes to internal schema, publishes events |
| **Notification Service** | Push (APNs/FCM), email, in-app via WebSocket — draft reminders, score alerts |

---

## 4. Repository & Project Structure

```
poolmaster/
├── services/
│   ├── core-api/              # Fastify + TypeScript, main REST API
│   ├── draft-service/         # Fastify + WS, draft orchestration
│   ├── scoring-service/       # Score computation worker
│   ├── ingestion-worker/      # Stats data ingestion
│   └── notification-service/
├── packages/
│   └── shared/
│       ├── domain/            # Shared TypeScript domain types & interfaces
│       ├── db/                # Repository port interfaces
│       ├── events/            # Event schema definitions (shared message contracts)
│       └── utils/             # Shared utilities
├── clients/
│   ├── web/                   # React + TypeScript
│   ├── mobile/                # React Native (Expo)
│   ├── shared/                # Shared TypeScript types, API client, validation
│   ├── ios/                   # Swift / SwiftUI
│   └── android/               # Kotlin
├── infrastructure/
│   ├── docker/
│   ├── k8s/                   # or ECS task definitions
│   └── terraform/
└── rules/                     # Architecture and testing rules
```

> **Full project structure:** See [Architecture Rules](../rules/architecture-rules.md) § Project Structure for the canonical layout.

This is a **monorepo** (Turborepo + npm workspaces) so packages share types, interfaces, and event schemas without duplication.

---

## 5. Database Port/Adapter Design

No service touches a database directly. All DB access goes through a typed port interface, and the adapter is injected at startup via a `DatabaseFactory` that reads `DB_RELATIONAL_ADAPTER` and `DB_NOSQL_ADAPTER` from environment config.

> **Full pattern details:** See [Architecture Rules](../rules/architecture-rules.md) § Port / Adapter (Hexagonal Architecture).

### Relational Port Example

```typescript
// packages/shared/db/ports/LeagueRepository.ts
export interface LeagueRepository {
  findById(id: string, tenantId: string): Promise<League | null>;
  findByTenant(tenantId: string): Promise<League[]>;
  create(league: CreateLeagueInput): Promise<League>;
  update(id: string, updates: Partial<League>): Promise<League>;
  delete(id: string): Promise<void>;
}
```

### NoSQL Port Example

```typescript
// packages/shared/db/ports/TeamPointsRepository.ts
export interface TeamPointsRepository {
  appendPointsEvent(event: TeamPointsEvent): Promise<void>;
  getRunningTotal(contestId: string, teamId: string): Promise<number>;
  getTimeline(contestId: string, teamId: string): Promise<TeamPointsEvent[]>;
  getLeaderboard(contestId: string): Promise<TeamStanding[]>;
}
```

### Adapters

```typescript
// Relational adapters
export class PostgresLeagueRepository implements LeagueRepository { ... }
export class MySQLLeagueRepository implements LeagueRepository { ... }

// NoSQL adapters
export class DynamoTeamPointsRepository implements TeamPointsRepository { ... }
export class MongoTeamPointsRepository implements TeamPointsRepository { ... }
```

Services never import adapters directly — only ports. The correct implementation is injected at startup.

---

## 6. Draft Engine Design

The draft engine is the most complex stateful component. It lives in the Draft Service.

### Core Interface

```typescript
interface DraftEngine {
  startSession(contestId: string): Promise<DraftSession>;
  submitPick(sessionId: string, teamId: string, participantId: string): Promise<DraftPick>;
  skipPick(sessionId: string): Promise<DraftPick>;  // auto-pick on timeout
  pauseSession(sessionId: string): Promise<void>;
  getSessionState(sessionId: string): Promise<DraftSessionState>;
}
```

### Strategy Pattern for Draft Types

```typescript
interface DraftStrategy {
  getPickOrder(session: DraftSession): TeamId[];        // snake reverses on even rounds
  validatePick(pick: ProposedPick, session: DraftSession): ValidationResult;
  isComplete(session: DraftSession): boolean;
}

class SnakeDraftStrategy implements DraftStrategy { ... }
class SalaryCapDraftStrategy implements DraftStrategy { ... }
class TieredDraftStrategy implements DraftStrategy { ... }
```

### Draft Modes

- **LIVE:** WebSocket room per draft session. Each manager is connected and on-the-clock. A countdown timer triggers auto-pick on expiry.
- **ASYNC:** REST-based. Picks are submitted via HTTP. Push notifications (APNs/FCM) alert the manager when it's their turn. Same engine underneath.

### WebSocket Events (Live Draft)

| Event | Direction | Payload |
|---|---|---|
| `draft:pick_made` | Server → All clients | Pick details, updated board |
| `draft:on_clock` | Server → All clients | Team on clock, deadline timestamp |
| `draft:auto_picked` | Server → All clients | Auto-pick result |
| `draft:complete` | Server → All clients | Final rosters |
| `draft:submit_pick` | Client → Server | Proposed participant selection |

---

## 7. Scoring Engine Design

Scoring rules are stored as JSONB config and interpreted at runtime, making the engine fully sport-agnostic.

### Scoring Rule Schema

```typescript
interface ScoringRule {
  stat: string;           // e.g. "strokes_under_par", "position", "laps_led"
  condition?: Condition;  // e.g. { operator: "lte", value: -10 }
  points: number;
  multiplier?: number;
}

// Example golf contest scoring config:
const golfScoringConfig: ScoringConfig = {
  rules: [
    { stat: "position", condition: { operator: "eq", value: 1 }, points: 100 },
    { stat: "position", condition: { operator: "eq", value: 2 }, points: 75 },
    { stat: "strokes_under_par", points: 5 },  // 5pts per stroke under par
  ],
  knockout: false,
  cumulative: true,
};
```

### Scoring Event Flow

When a stats event arrives from the ingestion worker:

1. Scoring Service receives the event from the message bus
2. Looks up all active contests containing the participant
3. Looks up all teams that have that participant on their roster
4. Applies the contest's scoring rules to the stat deltas
5. Appends a `TeamPointsEvent` to NoSQL
6. Periodically (or on-demand) rolls up totals into `ContestStanding` in SQL

---

## 8. Client Update Strategy

### Phase 1 — Polling (v1 launch)

All client data freshness is achieved via **configurable polling** from the client. This is the simplest approach, requires no additional infrastructure, and is sufficient for the v1 contest types (picks lock before events start; leaderboards update on scoring intervals, not sub-second).

| Surface | Default Interval | Configurable | Notes |
|---|---|---|---|
| **Leaderboard / standings** | 10 seconds | Yes | Clients poll `GET /contests/:id/standings` |
| **Draft room (async)** | 10 seconds | Yes | Clients poll `GET /drafts/:id` for current state |
| **Contest status** | 30 seconds | Yes | Lock time, completion, period transitions |
| **Notifications** | 30 seconds | Yes | Clients poll `GET /notifications/unread-count` |

**Configuration:** Polling intervals are set client-side per surface. The API returns `Cache-Control` and `ETag` headers so unchanged responses are cheap (304 Not Modified). A global config value `POLL_INTERVAL_MS` (default: 10000) can be overridden per surface.

**Why polling first:**
- No WebSocket infrastructure to build, deploy, or scale
- No Redis Pub/Sub, no connection state management, no reconnection logic
- Draft room works well as async (REST-based picks with timer) — most pool/office formats are async
- Leaderboards update on scoring intervals (minutes), not real-time seconds
- Push notifications (APNs/FCM) handle time-sensitive alerts (draft pick reminders)

### Future Phase — WebSockets / SSE (deferred)

When user demand or a live draft experience requires sub-second updates, upgrade specific surfaces to WebSocket or SSE:

| Channel | Mechanism | Trigger to Build |
|---|---|---|
| **Live draft room** | WebSocket (per session) | When live synchronous drafts are needed |
| **Live scores** | SSE (per contest) | When scoring events need sub-10s delivery |
| **In-app notifications** | WebSocket | When polling latency is insufficient for UX |

This upgrade is additive — polling continues to work as a fallback. WebSocket/SSE infrastructure (Socket.io + Redis adapter for multi-instance fan-out) is built only when needed.

---

## 9. Multi-Tenancy Approach

Every row in every relational table carries a `tenant_id`. A `TenantContext` middleware extracts the tenant from the JWT or subdomain on every request and attaches it to the request context. Repository implementations always scope queries by `tenant_id` — it is not optional and not caller-supplied after the middleware step. This prevents cross-tenant data leakage at the data layer rather than relying solely on application logic.

---

## 10. Key Technology Decisions

> **Canonical source:** See [Architecture Rules](../rules/architecture-rules.md) for the full, authoritative tech stack. Summary below.

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript throughout | Type safety across monorepo, shared domain types |
| API Framework | Fastify | Modular plugins, JSON schema validation, high performance |
| Auth | Auth0 or AWS Cognito | Handles OAuth, MFA, JWT — no reinventing |
| Relational DB | PostgreSQL (primary), MySQL (adapter) | JSONB support in Postgres is heavily used |
| NoSQL | DynamoDB (primary), MongoDB (adapter) | DynamoDB scales without ops burden on AWS |
| Message Bus | AWS EventBridge or SQS+SNS, Redis Streams | Decouples scoring from ingestion, fan-out |
| Client Updates | Polling (10s configurable) | Simple, no WS infrastructure; upgrade to WebSocket/SSE when needed |
| Task Queue | BullMQ + Redis | Background jobs, scheduled notifications, data processing |
| Containers | Docker on ECS Fargate or EKS | Scales each service independently |
| IaC | Terraform | Reproducible infra across environments |
| Monorepo | Turborepo | Fast builds, shared packages, clean boundaries |

---

## 11. Build Phases

### Phase 1 — Foundation (Weeks 1–4)
- Monorepo setup (Turborepo), TypeScript config, shared domain types
- Auth (JWT + OAuth via Auth0 or Cognito)
- DB port/adapter interfaces + Postgres adapter + DynamoDB adapter
- Core domain: Tenants, Users, Leagues, Memberships
- Basic REST API with tenant scoping middleware
- CI/CD pipeline, Docker images, ECS/EKS scaffolding

### Phase 2 — Contest & Roster (Weeks 5–8)
- Sports, Seasons, Contests, DraftConfiguration
- ContestParticipantPool management (commissioner uploads/configures the field)
- Contest entry creation and pick management
- Snake draft engine (async mode first — simpler to build and test)
- Basic standings (manual or seeded data for testing)

### Phase 3 — Scoring Engine (Weeks 9–12)
- Stats ingestion worker (start with one sport — golf recommended as a clean first model)
- Scoring rule evaluator (JSONB rule config → point computation)
- NoSQL writes for participant stats and team points
- SQL standings rollup (periodic + on-demand)
- REST endpoints for leaderboard and contest state

### Phase 4 — Client Polling & Push (Weeks 13–16)
- Polling endpoints with ETag/304 support for standings, draft state, contest status
- Configurable poll interval (default 10s) with per-surface overrides
- Push notification service (APNs + FCM) for draft pick reminders and score milestones
- **Deferred:** WebSocket/SSE for live draft room and sub-second leaderboards (build when needed)

### Phase 5 — Budget Pick, Tiered Pick & Survivor (Weeks 17–18)
- Budget pick selection with cost validation
- Tiered pick selection with tier enforcement
- Survivor / pick'em pick submission (live pick and locked pick modes)

### Phase 6 — Bracket & Knockout Contests (Weeks 19–21)
- Bracket contest type (NCAA March Madness model)
- Knockout scoring logic (elimination tracking in `TeamRoster.is_active`)
- Bracket visualization API

### Phase 7 — Polish & SaaS Hardening (Weeks 22–24)
- MySQL adapter + MongoDB adapter (swap-in alternatives for customers)
- Tenant onboarding flow, billing webhook hooks (Stripe)
- Commissioner dashboard for contest and league management
- Load testing, performance tuning, RDS read replicas, DynamoDB capacity planning

---

## 12. Suggested First Sprint (Claude Code Starting Point)

When opening this project in Claude Code, a productive first sprint is:

1. **Scaffold the monorepo** — Turborepo + npm workspaces, root `tsconfig.json`, shared ESLint/Prettier config
2. **Create `packages/shared/domain`** — All TypeScript interfaces for the full domain model (no implementation, just types)
3. **Create `packages/shared/db`** — Port interfaces for all repositories
4. **Create `packages/core-api`** — Fastify app shell with tenant hook, auth plugin, health check, and DI wiring
5. **Implement Postgres adapter** for `LeagueRepository` and `UserRepository` as the first working slice
6. **Write database migrations** (using Prisma Migrate or Knex) for the Tenant, User, League, LeagueMembership, Sport, and Season tables
7. **First working API route:** `POST /leagues` and `GET /leagues` — end-to-end through the port/adapter stack
8. **Set up tests** — Jest + testcontainers for integration tests, fishery for test data

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 01-001 | 1 | Monorepo setup (Turborepo + npm workspaces, tsconfig, ESLint/Prettier) | Done | `package.json`, `turbo.json`, `tsconfig.base.json` |
| 01-002 | 1 | Shared domain types — TypeScript interfaces for all entities | Done | 16 interfaces + enums in `packages/shared/domain/` |
| 01-003 | 1 | Repository port interfaces for all repos | Done | 17 repo interfaces in `packages/shared/db/ports.ts` |
| 01-004 | 1 | Event schemas — StatEvent, DraftPick, Contest lifecycle | Done | `packages/shared/events/` |
| 01-005 | 1 | Auth integration (JWT + OAuth via Auth0 or Cognito) | Done | Auth module: register, login, refresh, logout, forgot-password, OAuth callback, /me. JWT access (15m) + refresh (7d) with rotation. bcryptjs hashing. `auth-service.ts`, `handler.ts`, `routes.ts` |
| 01-006 | 1 | Prisma schema — full domain model (18 models) | Done | `packages/core-api/prisma/schema.prisma` |
| 01-007 | 1 | Prisma adapter for UserRepository | Done | Auth module uses PrismaClient directly for user CRUD; 16 Prisma adapters exist in `adapters/` |
| 01-008 | 1 | Prisma adapter for LeagueRepository | Done | `prisma-league-repository.ts` in adapters |
| 01-009 | 1 | Prisma adapter for LeagueMembershipRepository | Done | `prisma-league-membership-repository.ts` in adapters |
| 01-010 | 1 | DB migrations — run `prisma migrate dev` to generate initial migration | Done | CI pipeline runs `prisma migrate deploy` against test DB |
| 01-011 | 1 | TenantContext Fastify hook (extract tenant from JWT/subdomain) | Done | Resolves tenant from JWT claim first, falls back to `x-tenant-id` header, returns 401 if missing. `tenant-context.ts` + `auth-guard.ts` plugin |
| 01-012 | 1 | Core API — `POST /leagues` and `GET /leagues` end-to-end | In Progress | Route + handler stubs exist, needs Prisma wiring |
| 01-013 | 1 | CI/CD pipeline (GitHub Actions: lint, type check, test, build) | Done | `.github/workflows/ci.yml` — lint+typecheck, test (Postgres+Redis services), build |
| 01-014 | 1 | Docker images for each service | Done | 7 Dockerfiles (5 services + web + admin), nginx.conf, docker-compose.yml |
| 01-015 | 1 | ECS/EKS scaffolding (Terraform) | Done | `main.tf` (VPC, ECS Fargate, RDS, ElastiCache, ALB, ECR, CloudWatch), `variables.tf`, `outputs.tf` |
| 01-016 | 2 | Sport and Season CRUD endpoints | Done | Participants module with sport/season routes in `modules/participants/` |
| 01-017 | 2 | Contest CRUD endpoints | Done | Full CRUD in `modules/contests/` with selection config, scoring templates, payout validation |
| 01-018 | 2 | SelectionConfig CRUD | Done | Created atomically with contests via `ContestService.createContest` |
| 01-019 | 2 | ContestParticipantPool management endpoints | Done | Pool routes in `modules/participants/pool-routes.ts` |
| 01-020 | 2 | Contest entry creation and pick management | Done | Entry + pick management in contest modules, draft overrides for pick management |
| 01-021 | 2 | Snake draft engine — async mode | Done | 8 engines built in draft-service: snake, tiered, budget, survivor, pick'em, bracket + session manager + draft order |
| 01-022 | 2 | Basic standings endpoint (manual/seeded data) | Done | Standings module: paginated leaderboard, top-N summary, my-entry with rank context and movement indicators. `modules/standings/` |
| 01-023 | 3 | Stats ingestion worker — golf adapter | Done | EventBus in `shared/events/event-bus.ts`, score-publisher in `ingestion-worker/src/core/score-publisher.ts` transforms ProviderStatEvent→StatEvent and publishes to bus. `onLiveScores` callback wired. |
| 01-024 | 3 | Scoring rule evaluator (JSONB config → points) | Done | StatEventConsumer in `scoring-service/src/consumer/stat-event-consumer.ts` — subscribes to `stat.updated`, looks up contests/entries via ContestLookup, scores with `scoreParticipant()`, stores in ScoreStore, publishes `score.updated`. |
| 01-025 | 3 | NoSQL writes for ParticipantEventStats and TeamContestPoints | Done | In-memory ScoreStore in `scoring-service/src/storage/score-store.ts` with append-only participant/entry scores, leaderboard, timeline, and participant queries. DynamoDB-ready interface. |
| 01-026 | 3 | SQL standings rollup (periodic + on-demand) | Done | `StandingsRollup` in `scoring-service/src/rollup/standings-rollup.ts` — periodic (30s default) and on-demand rollup, rank assignment with tie handling, rank-change tracking, publishes `standings.updated`. |
| 01-027 | 3 | Leaderboard and contest state REST endpoints | Done | 5 endpoints in `scoring-service/src/modules/scoring/`: leaderboard, entry detail, participant history, manual rollup trigger, detailed health. Handler + service layer pattern. Wired in `index.ts` with shutdown cleanup. |
| 01-028 | 4 | Polling endpoints with ETag/304 support (standings, draft, contest status) | Not Started | Default 10s interval |
| 01-029 | 4 | Configurable poll interval per surface (leaderboard, draft, notifications) | Not Started | `POLL_INTERVAL_MS` default 10000 |
| 01-030 | 4 | Push notification service (APNs + FCM) | Not Started | Draft reminders, score milestones |
| 01-031 | — | ~~WebSocket/SSE for live draft room and leaderboards~~ | Deferred | Build when live synchronous drafts needed |
| 01-032 | 5 | Budget pick selection + cost validation | Done | `budget-pick-engine.ts` — see 02-011 |
| 01-033 | 5 | Tiered pick selection + tier enforcement | Done | `tiered-pick-engine.ts` — see 02-008 |
| 01-034 | 5 | Survivor / pick'em pick submission flow | Done | `survivor-engine.ts`, `pickem-engine.ts` — see 02-014, 02-018 |
| 01-035 | 6 | Bracket contest type (NCAA March Madness model) | Done | `bracket-engine.ts` — see 02-020 |
| 01-036 | 6 | Knockout scoring logic | Done | Survivor engine handles elimination — see 02-014 to 02-017 |
| 01-037 | 6 | Bracket visualisation API | Not Started | |
| 01-038 | 7 | MySQL adapter + MongoDB adapter | Not Started | |
| 01-039 | 7 | Tenant onboarding flow + Stripe billing hooks | Not Started | |
| 01-040 | 7 | Commissioner dashboard | Not Started | |
| 01-041 | 7 | Load testing and performance tuning | Not Started | |

---

*Generated by Claude — PoolMaster Architecture Plan v1.0*
