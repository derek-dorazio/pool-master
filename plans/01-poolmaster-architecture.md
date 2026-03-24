# PoolMaster Platform — Architecture & Build Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

---

## Plan Index

| # | Document | Coverage |
|---|---|---|
| 01 | [Architecture & Build Plan](01-poolmaster-architecture.md) | Architecture, domain model, tech stack, service topology, build phases |
| 02 | [Draft Configuration](02-poolmaster-draft-config.md) | Snake, salary cap, tiered draft formats, auto-pick, waiver wire |
| 03 | [Scoring Rules](03-poolmaster-scoring-rules.md) | Sport-specific scoring configs, stat schemas, scoring engine flow |
| 04 | [Contest History](04-poolmaster-history.md) | Contest history, league history, records, rivalries, analytics |
| 05 | [Sports Data Integration](05-poolmaster-sports-data-integration.md) | Provider adapters, ingestion pipelines, polling, outage handling |
| 06 | [Participant Data](06-poolmaster-participant-data.md) | Participant profiles, pricing, tiers, pools, deduplication, search |
| 07 | [Billing & Subscriptions](07-poolmaster-billing-subscription.md) | Plan tiers, entitlements, Stripe, trials, dunning, revenue analytics |
| 08 | [Commissioner Tooling](08-poolmaster-commissioner-tooling.md) | League/contest wizards, overrides, dashboard, templates, audit trail |
| 09 | [Notifications & Alerts](09-poolmaster-notifications-alerts.md) | Event taxonomy, channels, preferences, templates, scheduling |
| 10 | [Social & Communication](10-poolmaster-social-communication.md) | Activity feed, chat, DMs, recaps, share-to-social, moderation |
| 11 | [Admin Dashboard](11-poolmaster-admin-dashboard.md) | Tenant/user management, feature flags, platform health, support tools |
| 12 | [Mobile Client](12-poolmaster-mobile-client.md) | React Native, offline caching, push, deep linking, draft room mobile |
| 13 | [Search & Discovery](13-poolmaster-search-discovery.md) | Draft search, pool setup filtering, public league discovery |
| 14 | [Localisation & i18n](14-poolmaster-localisation-i18n.md) | Timezone handling, multi-currency, number formatting, translation |
| 15 | [Responsible Gaming](15-poolmaster-responsible-gaming.md) | Age verification, geographic restrictions, GDPR/CCPA, data retention |
| 16 | [Gap Analysis](16-poolmaster-gap-analysis.md) | Missing feature areas, priority assessment, recommended planning order |

---

## 1. Vision & Scope

A multi-tenant SaaS platform where groups of friends (or colleagues) create leagues, configure contests across any sport, draft squads, and compete on live leaderboards. The platform is sport-agnostic by design — golf, tennis, F1, NCAA brackets, horse racing, and anything else are all first-class citizens configured through a flexible domain model rather than hard-coded sport logic.

**Target clients:** Web (React), iOS (Swift/SwiftUI), Android (Kotlin)
**Backend:** Python + FastAPI
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
  ├── contest_type: SINGLE_EVENT | SEASON_LONG | BRACKET
  ├── scoring_type: CUMULATIVE | KNOCKOUT | BRACKET
  ├── draft_config_id → DraftConfiguration
  ├── starts_at, ends_at, lock_at  ← when picks lock
  └── rules_config: JSONB  ← flexible scoring rules per contest

DraftConfiguration
  ├── id, draft_type: SNAKE | SALARY_CAP | TIERED
  ├── draft_mode: LIVE | ASYNC
  ├── rounds, time_per_pick (seconds), auto_pick_policy
  ├── budget (for SALARY_CAP)
  ├── tier_config: JSONB (for TIERED: tier definitions, picks per tier)
  └── is_exclusive: boolean  ← false for salary cap (shared participants)

ContestParticipantPool
  ├── contest_id, participant_id
  ├── cost (for SALARY_CAP)
  ├── tier (for TIERED)
  └── is_available: boolean
```

### Team & Draft Layer

```
Team
  ├── id, contest_id, league_membership_id, name
  └── → TeamRoster entries

TeamRoster
  ├── team_id, participant_id
  ├── drafted_at, draft_round, draft_pick_number
  └── is_active (for knockout: still alive?)

DraftSession
  ├── id, contest_id, status: PENDING | LIVE | PAUSED | COMPLETE
  ├── current_pick_number, current_team_id (on the clock)
  ├── started_at, pick_deadline (for async)
  └── → DraftPicks

DraftPick
  ├── id, draft_session_id, team_id, participant_id
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
   │ (Python/FastAPI)│   │(Python/FastAPI) │  │ (Python/FastAPI) │
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
| **Core API** | Auth, leagues, memberships, contests, roster management, standings reads |
| **Draft Service** | Draft session lifecycle, live/async pick orchestration, WebSocket room per draft |
| **Scoring Service** | Consumes stat events, applies scoring rules, writes to NoSQL, updates SQL standings |
| **Stats Ingestion Worker** | Polls or receives webhooks from sport data providers, normalizes to internal schema, publishes events |
| **Notification Service** | Push (APNs/FCM), email, in-app via WebSocket — draft reminders, score alerts |

---

## 4. Repository & Project Structure

```
poolmaster/
├── services/
│   ├── core-api/              # FastAPI, main REST API
│   ├── draft-service/         # FastAPI + WebSocket, draft orchestration
│   ├── scoring-service/       # Score computation worker
│   ├── ingestion-worker/      # Stats data ingestion
│   └── notification-service/
├── packages/
│   └── shared/
│       ├── domain/            # Shared Python domain types (Pydantic models)
│       ├── db/                # Repository port interfaces (Protocols)
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

Backend services share Python domain types and repository interfaces via the `packages/shared` package. Frontend clients share TypeScript types and the API client via `clients/shared`.

---

## 5. Database Port/Adapter Design

No service touches a database directly. All DB access goes through typed repository interfaces (ports using Python's `Protocol`), and the adapter is injected at startup via a factory that reads `DB_RELATIONAL_ADAPTER` and `DB_NOSQL_ADAPTER` from environment config.

> **Full pattern details:** See [Architecture Rules](../rules/architecture-rules.md) § Port / Adapter (Hexagonal Architecture).

### Relational Port Example

```python
# packages/shared/db/ports/league_repository.py
from typing import Protocol

class LeagueRepository(Protocol):
    async def find_by_id(self, id: str, tenant_id: str) -> League | None: ...
    async def find_by_tenant(self, tenant_id: str) -> list[League]: ...
    async def create(self, league: CreateLeagueInput) -> League: ...
    async def update(self, id: str, updates: dict) -> League: ...
    async def delete(self, id: str) -> None: ...
```

### NoSQL Port Example

```python
# packages/shared/db/ports/team_points_repository.py
class TeamPointsRepository(Protocol):
    async def append_points_event(self, event: TeamPointsEvent) -> None: ...
    async def get_running_total(self, contest_id: str, team_id: str) -> float: ...
    async def get_timeline(self, contest_id: str, team_id: str) -> list[TeamPointsEvent]: ...
    async def get_leaderboard(self, contest_id: str) -> list[TeamStanding]: ...
```

### Adapters

```python
# Relational adapters (SQLAlchemy 2.0 async)
class PostgresLeagueRepository(LeagueRepository): ...
class MySQLLeagueRepository(LeagueRepository): ...

# NoSQL adapters
class DynamoTeamPointsRepository(TeamPointsRepository): ...
class MongoTeamPointsRepository(TeamPointsRepository): ...
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

## 8. Real-Time Architecture

Three distinct real-time channels:

| Channel | Mechanism | Use Case |
|---|---|---|
| **Draft room** | WebSocket (per session) | Live pick-by-pick draft experience |
| **Live scores** | WebSocket or SSE (per contest) | Leaderboard updates during events |
| **Notifications** | APNs + FCM + in-app WS | Draft reminders, score milestones, contest results |

The WebSocket gateway (in the Draft Service, and optionally a separate Realtime Service at scale) subscribes to the message bus and fans out events to connected clients. **Redis Pub/Sub** allows the WebSocket layer to scale across multiple container instances without routing issues.

---

## 9. Multi-Tenancy Approach

Every row in every relational table carries a `tenant_id`. A `TenantContext` FastAPI dependency extracts the tenant from the JWT or subdomain on every request and attaches it to the request context. Repository implementations always scope queries by `tenant_id` — it is not optional and not caller-supplied after the middleware step. This prevents cross-tenant data leakage at the data layer rather than relying solely on application logic.

---

## 10. Key Technology Decisions

> **Canonical source:** See [Architecture Rules](../rules/architecture-rules.md) for the full, authoritative tech stack. Summary below.

| Concern | Choice | Rationale |
|---|---|---|
| Backend Language | Python 3.12+ | Mature ecosystem, strong data processing, fast development |
| API Framework | FastAPI | Async-native, automatic OpenAPI docs, Pydantic validation |
| Frontend Language | TypeScript | Type safety across web and mobile clients |
| Frontend Framework | React (web) + React Native (mobile) | Shared component model, large ecosystem |
| Auth | Auth0 or AWS Cognito | Handles OAuth, MFA, JWT — no reinventing |
| Relational DB | PostgreSQL (primary), MySQL (adapter) | JSONB support in Postgres is heavily used |
| NoSQL | DynamoDB (primary), MongoDB (adapter) | DynamoDB scales without ops burden on AWS |
| Message Bus | AWS EventBridge or SQS+SNS, Redis Streams | Decouples scoring from ingestion, fan-out |
| WebSockets | FastAPI WebSocket + Redis Pub/Sub | Native async support; Redis for multi-instance clustering |
| Task Queue | Celery + Redis (or ARQ) | Background jobs, scheduled notifications, data processing |
| Containers | Docker on ECS Fargate or EKS | Scales each service independently |
| IaC | Terraform | Reproducible infra across environments |

---

## 11. Build Phases

### Phase 1 — Foundation (Weeks 1–4)
- Project structure setup, Python package config, shared domain types (Pydantic)
- Auth (JWT + OAuth via Auth0 or Cognito)
- DB port/adapter interfaces (Protocol classes) + Postgres adapter + DynamoDB adapter
- Core domain: Tenants, Users, Leagues, Memberships
- Basic FastAPI REST API with tenant scoping dependency
- CI/CD pipeline, Docker images, ECS/EKS scaffolding

### Phase 2 — Contest & Roster (Weeks 5–8)
- Sports, Seasons, Contests, DraftConfiguration
- ContestParticipantPool management (commissioner uploads/configures the field)
- Team creation and roster management
- Snake draft engine (async mode first — simpler to build and test)
- Basic standings (manual or seeded data for testing)

### Phase 3 — Scoring Engine (Weeks 9–12)
- Stats ingestion worker (start with one sport — golf recommended as a clean first model)
- Scoring rule evaluator (JSONB rule config → point computation)
- NoSQL writes for participant stats and team points
- SQL standings rollup (periodic + on-demand)
- REST endpoints for leaderboard and contest state

### Phase 4 — Real-Time (Weeks 13–16)
- WebSocket server for draft rooms (FastAPI WebSocket + Redis Pub/Sub)
- Live draft — on-the-clock timer, auto-pick on expiry
- WebSocket/SSE for live contest leaderboards
- Push notification service (APNs + FCM) for async draft turns and score milestones

### Phase 5 — Salary Cap & Tiered Drafts (Weeks 17–18)
- `SalaryCapDraftStrategy` + budget validation
- `TieredDraftStrategy` + tier enforcement per round
- UI flows for each draft type on web and mobile

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

1. **Scaffold the project** — Create `services/`, `packages/shared/`, `clients/` directory structure with `pyproject.toml` configs
2. **Create `packages/shared/domain`** — All Pydantic models for the full domain model (no implementation, just types)
3. **Create `packages/shared/db`** — Repository port interfaces (Python Protocol classes) for all repositories
4. **Create `services/core-api`** — FastAPI app shell with tenant dependency, auth middleware, health check, and dependency injection wiring
5. **Implement Postgres adapter** for `LeagueRepository` and `UserRepository` as the first working slice (SQLAlchemy 2.0 async)
6. **Write database migrations** (using Alembic) for the Tenant, User, League, LeagueMembership, Sport, and Season tables
7. **First working API route:** `POST /leagues` and `GET /leagues` — end-to-end through the port/adapter stack
8. **Set up tests** — pytest + testcontainers for integration tests, factory-boy for test data

---

*Generated by Claude — PoolMaster Architecture Plan v1.0*
