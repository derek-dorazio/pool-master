# PoolMaster — Testing Rules

All services and clients must follow these testing standards. This document defines the testing strategy, tools, coverage requirements, and conventions for the PoolMaster platform.

> **Architecture dependency:** This document assumes the tech stack defined in [architecture-rules.md](../rules/architecture-rules.md). Backend = Node.js + Express + TypeScript. Frontend = React + TypeScript. Mobile = React Native.

---

## 1. Testing Tools

### Backend (Node.js + TypeScript)

| Tool | Purpose |
|---|---|
| **Jest** (or **Vitest**) | Test runner and framework |
| **supertest** | HTTP assertion library for Express API testing |
| **fishery** | Test data factories (generate realistic domain objects) |
| **Faker** (`@faker-js/faker`) | Generate fake data (names, emails, dates) |
| **testcontainers** (`testcontainers-node`) | Spin up PostgreSQL, Redis, DynamoDB containers for integration tests |
| **aws-sdk-client-mock** | Mock AWS services (S3, SQS, DynamoDB) for unit tests |
| **sinon** (or Jest mocks) | Stubs, spies, and mocks for time, dependencies |
| **nock** | Mock HTTP requests to external APIs (sports data providers, Stripe) |

### Frontend (React + TypeScript)

| Tool | Purpose |
|---|---|
| **Vitest** | Test runner (fast, Vite-native, Jest-compatible API) |
| **React Testing Library** | Component testing (user-centric, not implementation-detail) |
| **MSW (Mock Service Worker)** | Mock API responses at the network level |
| **Playwright** | End-to-end browser tests |

### Mobile (React Native)

| Tool | Purpose |
|---|---|
| **Jest** | Test runner (React Native default) |
| **React Native Testing Library** | Component testing |
| **Detox** | End-to-end mobile testing (iOS + Android simulators) |

---

## 2. Test Layers

### Layer Definitions

```
┌─────────────────────────────────────────────────┐
│            E2E Tests (Playwright / Detox)         │  Few, slow, high confidence
│  Full user flows through real UI + real API        │
├─────────────────────────────────────────────────┤
│         Integration Tests (testcontainers)        │  Moderate count
│  Service + real DB + real Redis + real message bus │
├─────────────────────────────────────────────────┤
│              Unit Tests (Jest / Vitest)            │  Many, fast, focused
│  Single function/class, mocked dependencies        │
└─────────────────────────────────────────────────┘
```

### Backend Test Layers

| Layer | Scope | Database | External Services | Speed |
|---|---|---|---|---|
| **Unit** | Single function, class, or Zod schema | Mocked | Mocked | < 1s per test |
| **Integration** | Service → repository → real database | Real (testcontainers PostgreSQL) | Mocked (nock, aws-sdk-client-mock) | < 5s per test |
| **API** | Full HTTP request → response cycle | Real (testcontainers) | Mocked | < 5s per test |
| **E2E** | Multi-service flows | Real | Real (staging providers) | < 30s per test |

### Frontend Test Layers

| Layer | Scope | API | Speed |
|---|---|---|---|
| **Unit** | Component rendering, hooks, utilities | Mocked (MSW) | < 1s per test |
| **Integration** | Multi-component flows, form submissions | Mocked (MSW) | < 3s per test |
| **E2E** | Full user journey in real browser | Real (staging API) | < 30s per test |

---

## 3. Coverage Requirements

### Minimum Coverage Thresholds

| Service / Package | Line Coverage | Branch Coverage | Enforced In |
|---|---|---|---|
| `shared/domain` | 95% | 90% | CI (block merge) |
| `shared/events` | 90% | 85% | CI (block merge) |
| `core-api` | 85% | 80% | CI (block merge) |
| `draft-service` | 90% | 85% | CI (block merge) |
| `scoring-service` | 95% | 90% | CI (block merge) |
| `ingestion-worker` | 85% | 80% | CI (block merge) |
| `notification-service` | 80% | 75% | CI (block merge) |
| `clients/web` | 80% | 75% | CI (warn, don't block) |
| `clients/mobile` | 70% | 65% | CI (warn, don't block) |

### Why Scoring Service Is Highest

The scoring engine is the most business-critical component. An incorrect score calculation directly affects contest results and payouts. Every scoring rule, bonus, penalty, multiplier, and edge case (missed cut, DNF, corrections) must have dedicated test cases.

---

## 4. What Must Be Tested

### Backend — Required Test Cases

**Domain models and schemas:**
- Zod schema validation (valid and invalid inputs)
- Serialisation / deserialisation round-trips
- Enum value validation

**Repository layer:**
- CRUD operations against real PostgreSQL (integration tests)
- Tenant isolation (query with wrong tenant_id returns nothing)
- Edge cases: duplicate keys, not found, concurrent updates

**API endpoints:**
- Happy path for every endpoint
- Authentication required (401 without token)
- Authorisation (403 for wrong role — commissioner vs manager vs viewer)
- Validation errors (422 for invalid input)
- Tenant isolation (can't access another tenant's data)
- Pagination (first page, last page, empty results)

**Scoring engine:**
- Every scoring template (golf stroke play, NBA advancement, NCAA bracket, NHL player stats, soccer tournament, etc.)
- Every stat rule, bonus rule, penalty rule, multiplier rule
- Edge cases: missed cut, DNF, withdrawal, disqualification
- Data corrections (is_correction = true) and recalculation
- Tiebreaker chains
- BEST_N and DROP_LOWEST_N counting methods
- Position-based scoring with ranges

**Draft engine:**
- Snake pick order (odd rounds, even rounds, various team counts)
- Salary cap budget enforcement (max bid, reserve for remaining slots)
- Tiered draft tier enforcement (picks per tier, exclusivity)
- Auto-pick (queue → rankings → system default)
- Timer expiry and auto-pick trigger
- Commissioner overrides (undo, pause, extend clock)
- Draft state persistence and recovery after crash

**Notifications:**
- Event → template rendering → correct channel routing
- User preference filtering (push enabled, email disabled)
- Suppression rules (rate limiting, DND, dedup)
- Scheduled notification fire-at-time accuracy

**Entitlement service:**
- Plan-based access checks for every entitlement key
- Usage limit enforcement (leagues, contests, members)
- Admin overrides
- Graceful degradation on downgrade

### Frontend — Required Test Cases

**Components:**
- Render with expected props
- User interactions (click, type, submit)
- Loading, error, and empty states
- Responsive layout breakpoints (if applicable)

**Forms:**
- Validation rules (required fields, formats, ranges)
- Submission success and error handling
- Commissioner wizards (league setup, contest setup) — step-by-step flow

**Real-time:**
- WebSocket connection → message display
- Reconnection after disconnect
- Draft room: pick submission, timer display, auto-pick warning

---

## 5. Test Data Strategy

### Factories (Backend)

Use `fishery` to generate realistic test data. Every domain model has a factory.

```typescript
import { Factory } from "fishery";
import { v4 as uuid } from "uuid";
import { League, Contest } from "@poolmaster/shared/domain";

export const leagueFactory = Factory.define<League>(() => ({
  id: uuid(),
  tenantId: uuid(),
  name: faker.company.name(),
  description: faker.lorem.sentence(),
  createdBy: uuid(),
  visibility: "PRIVATE",
  maxMembers: 20,
}));

export const contestFactory = Factory.define<Contest>(() => ({
  id: uuid(),
  leagueId: uuid(),
  sport: "GOLF",
  contestType: "SINGLE_EVENT",
  scoringType: "CUMULATIVE",
  status: "DRAFT",
}));
```

### Fixtures (Backend)

Shared setup in `tests/setup.ts`:

```typescript
// Global test setup — DB connections, test containers
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer().start();
  redisContainer = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  // Set connection URLs in environment
});

afterAll(async () => {
  await pgContainer.stop();
  await redisContainer.stop();
});
```

### Seed Data

For E2E and manual testing, a seed script populates:
- 3 tenants (free, pro, league+)
- 2 leagues per tenant with 8-12 members each
- Participants for golf (PGA field), NFL (sample rosters)
- 1 completed contest with full history (for history feature testing)
- 1 active contest in draft state
- 1 active contest with live scoring

---

## 6. Test Conventions

### Naming

```typescript
// Backend: describe block = module, it block = behaviour
describe("LeagueService", () => {
  it("creates a league with valid data");
  it("rejects league creation without a name");
});

describe("ScoringEngine", () => {
  it("reverses snake draft pick order on even rounds");
  it("assigns penalty score for golf missed cut");
});

describe("EntitlementService", () => {
  it("blocks fourth league creation on free plan");
});
```

```typescript
// Frontend: describe block = component/feature, it block = behaviour
describe("DraftRoom", () => {
  it("displays countdown timer when user is on the clock");
  it("submits pick and shows confirmation");
  it("shows auto-pick warning at 10 seconds remaining");
});
```

### File Organisation

```
# Backend tests (top-level tests/ directory)
tests/
├── unit/
│   ├── core-api/
│   │   ├── league-service.test.ts
│   │   ├── scoring-engine.test.ts
│   │   └── entitlement-service.test.ts
│   └── shared/
│       └── domain-models.test.ts
├── integration/
│   ├── core-api/
│   │   ├── league-repository.test.ts
│   │   ├── contest-repository.test.ts
│   │   └── scoring-pipeline.test.ts
├── api/
│   ├── core-api/
│   │   ├── league-endpoints.test.ts
│   │   ├── contest-endpoints.test.ts
│   │   └── draft-endpoints.test.ts
├── factories/
│   ├── league.factory.ts
│   ├── contest.factory.ts
│   └── user.factory.ts
└── setup.ts

# Frontend tests (co-located within client)
clients/web/src/
├── components/
│   ├── DraftRoom/
│   │   ├── DraftRoom.tsx
│   │   └── DraftRoom.test.tsx
├── __tests__/
│   └── e2e/
│       ├── draft-flow.spec.ts
│       └── contest-setup.spec.ts
```

### Test Isolation

- Each test is independent — no shared mutable state between tests
- Database tests use transactions that roll back after each test (or fresh containers)
- Redis tests flush the test database between tests
- Time-dependent tests use Jest fake timers or sinon to freeze time
- External API tests use `nock` mocks — never call real providers in unit/integration tests

---

## 7. CI Pipeline

### Pipeline Stages

```
1. Lint & Format
   ├── Backend + Frontend: eslint + prettier --check
   └── Block merge on failure

2. Type Check
   ├── All packages: tsc --noEmit (via Turborepo)
   └── Block merge on failure

3. Unit Tests
   ├── Backend: jest tests/unit/ --coverage
   ├── Frontend: vitest run
   └── Block merge on failure or coverage below threshold

4. Integration Tests
   ├── Backend: jest tests/integration/ (testcontainers)
   └── Block merge on failure

5. API Tests
   ├── Backend: jest tests/api/ (testcontainers)
   └── Block merge on failure

6. E2E Tests (on merge to main only)
   ├── Frontend: playwright (against staging API)
   └── Notify on failure, don't block deploy

7. Build & Push
   ├── Docker build for each service
   ├── Push to ECR
   └── Deploy to staging
```

### Pre-Commit Hooks (via lint-staged + husky)

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

### Pull Request Requirements

- All CI stages 1-5 must pass
- At least one approval from a code reviewer
- No decrease in coverage percentage
- All new public functions/endpoints have tests

---

## 8. Sport-Specific Test Suites

Given the sport-agnostic scoring engine, each sport needs a dedicated test suite that validates its scoring templates against known real-world results.

### Validation Approach

```typescript
// For each sport, test against known historical results:
// "Given this scoring config and these real stat events,
//  the engine should produce these exact scores and standings."

describe("Golf scoring against real data", () => {
  it("stroke play scoring matches 2025 Masters actual results", () => {
    const config = SCORING_TEMPLATES["golf_dfs_standard"];
    const stats = loadFixture("masters_2025_stats.json");
    const results = scoringEngine.calculate(config, stats);
    expect(results[0].participantName).toBe("Scottie Scheffler");
    expect(results[0].totalPoints).toBeCloseTo(287.5, 1);
  });

  it("Stroke play scoring matches 2025 Masters actual results", () => {
    const config = SCORING_TEMPLATES["golf_stroke_pick6_use4"];
    // ... validate stroke play scoring
  });
});
```

### Required Fixtures Per Sport

| Sport | Fixture Data | Source |
|---|---|---|
| Golf | 1 major tournament full stats (72 holes, all players) | Historical provider data |
| NFL | 1 full week of games (all players, all stats) | Historical provider data |
| F1 | 1 race weekend (qualifying + race, all drivers) | Historical provider data |
| NCAA Basketball | 1 full tournament bracket (all 67 games) | Historical results |
| Tennis | 1 Grand Slam draw (128 players, all matches) | Historical results |
| Horse Racing | 1 major race (full field, positions, times) | Historical results |

---

## 9. Load Testing

### When to Run

- Before each major release
- After significant scoring engine changes
- After database schema changes
- When onboarding a large tenant

### Tools

- **k6** (JavaScript-based, runs natively) or **Artillery**
- Run against a dedicated load-test environment (mirrors production infra)

### Key Scenarios

| Scenario | Target | SLA |
|---|---|---|
| Live draft (12 teams, 60s picks) | WebSocket messages delivered | < 200ms p99 |
| Live scoring (50 contests, 1000 stat events/min) | Score recalculation | < 2s per contest |
| API burst (1000 concurrent leaderboard requests) | Response time | < 500ms p95 |
| Draft room reconnection (100 simultaneous reconnects) | State recovery | < 3s per client |
| Notification storm (contest completes, 500 notifications) | Delivery | < 30s all delivered |

### Performance Budgets

| Metric | Target |
|---|---|
| API response (p95) | < 200ms |
| API response (p99) | < 500ms |
| WebSocket message delivery (p95) | < 100ms |
| Scoring engine recalculation (per contest) | < 2s |
| Database query (p95) | < 50ms |
| Page load (web, LCP) | < 2.5s |
| App launch to interactive (mobile) | < 2s |

---

## 10. Testing Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Do This Instead |
|---|---|---|
| Mocking the database in integration tests | Hides real query issues, schema mismatches | Use testcontainers with real PostgreSQL |
| Testing implementation details | Tests break on refactor without behaviour change | Test inputs and outputs, not internal state |
| Shared mutable state between tests | Flaky tests, order-dependent failures | Isolate each test with fresh state |
| Sleeping in tests | Slow, flaky | Use async awaits, event signals, or polling with timeout |
| Ignoring flaky tests | They erode trust in the test suite | Fix or delete — never skip indefinitely |
| Testing only happy paths | Bugs hide in edge cases | Always test error cases, boundaries, and invalid input |
| Snapshot testing for dynamic data | Snapshots break on any data change | Use targeted assertions on specific fields |

---

*PoolMaster Testing Rules v1.0*
