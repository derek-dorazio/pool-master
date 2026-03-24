# PoolMaster — Testing Rules

All services and clients must follow these testing standards. This document defines the testing strategy, tools, coverage requirements, and conventions for the PoolMaster platform.

> **Architecture dependency:** This document assumes the tech stack defined in [architecture-rules.md](../rules/architecture-rules.md). Backend = Python + FastAPI. Frontend = React + TypeScript. Mobile = React Native.

---

## 1. Testing Tools

### Backend (Python)

| Tool | Purpose |
|---|---|
| **pytest** | Test runner and framework |
| **pytest-asyncio** | Async test support (FastAPI is async-native) |
| **pytest-cov** | Coverage reporting |
| **httpx** | Async HTTP client for API testing (FastAPI TestClient uses this) |
| **factory-boy** | Test data factories (generate realistic domain objects) |
| **Faker** | Generate fake data (names, emails, dates) |
| **testcontainers-python** | Spin up PostgreSQL, Redis, DynamoDB containers for integration tests |
| **moto** | Mock AWS services (S3, SQS, DynamoDB) for unit tests |
| **freezegun** | Freeze/mock time (critical for draft timers, scheduling, TTLs) |
| **respx** | Mock HTTP requests to external APIs (sports data providers, Stripe) |

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
│              Unit Tests (pytest / Vitest)          │  Many, fast, focused
│  Single function/class, mocked dependencies        │
└─────────────────────────────────────────────────┘
```

### Backend Test Layers

| Layer | Scope | Database | External Services | Speed |
|---|---|---|---|---|
| **Unit** | Single function, class, or Pydantic model | Mocked | Mocked | < 1s per test |
| **Integration** | Service → repository → real database | Real (testcontainers PostgreSQL) | Mocked (respx, moto) | < 5s per test |
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
- Pydantic model validation (valid and invalid inputs)
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
- Every scoring template (golf DFS, golf stroke play, NFL standard, NFL PPR, F1, NCAA bracket, etc.)
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

Use `factory-boy` to generate realistic test data. Every domain model has a factory.

```python
class LeagueFactory(factory.Factory):
    class Meta:
        model = League

    id = factory.LazyFunction(uuid4)
    tenant_id = factory.LazyFunction(uuid4)
    name = factory.Faker("company")
    description = factory.Faker("sentence")
    created_by = factory.LazyFunction(uuid4)
    visibility = "PRIVATE"
    max_members = 20

class ContestFactory(factory.Factory):
    class Meta:
        model = Contest

    id = factory.LazyFunction(uuid4)
    league_id = factory.LazyFunction(uuid4)
    sport = "GOLF"
    contest_type = "SINGLE_EVENT"
    scoring_type = "CUMULATIVE"
    status = "DRAFT"
```

### Fixtures (Backend)

Shared fixtures in `conftest.py` at the service level:

```python
@pytest.fixture
async def db_session():
    """Real PostgreSQL session via testcontainers."""
    ...

@pytest.fixture
async def redis_client():
    """Real Redis via testcontainers."""
    ...

@pytest.fixture
async def api_client(db_session):
    """FastAPI TestClient with real DB."""
    ...

@pytest.fixture
def tenant():
    """Default test tenant."""
    return TenantFactory()

@pytest.fixture
def commissioner(tenant):
    """Commissioner user in the test tenant."""
    return UserFactory(tenant_id=tenant.id, role="COMMISSIONER")
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

```python
# Backend: test_{what}_{scenario}_{expected_outcome}
def test_create_league_with_valid_data_returns_league():
def test_create_league_without_name_returns_422():
def test_snake_draft_pick_order_reverses_on_even_rounds():
def test_scoring_engine_golf_missed_cut_assigns_penalty_score():
def test_entitlement_check_free_plan_blocks_fourth_league():
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
# Backend
services/core-api/tests/
├── unit/
│   ├── test_league_service.py
│   ├── test_scoring_engine.py
│   └── test_entitlement_service.py
├── integration/
│   ├── test_league_repository.py
│   ├── test_contest_repository.py
│   └── test_scoring_pipeline.py
├── api/
│   ├── test_league_endpoints.py
│   ├── test_contest_endpoints.py
│   └── test_draft_endpoints.py
├── factories/
│   ├── league_factory.py
│   ├── contest_factory.py
│   └── user_factory.py
└── conftest.py

# Frontend
clients/web/src/
├── components/
│   ├── DraftRoom/
│   │   ├── DraftRoom.tsx
│   │   └── DraftRoom.test.tsx    # co-located
├── __tests__/
│   └── e2e/
│       ├── draft-flow.spec.ts
│       └── contest-setup.spec.ts
```

### Test Isolation

- Each test is independent — no shared mutable state between tests
- Database tests use transactions that roll back after each test (or fresh containers)
- Redis tests flush the test database between tests
- Time-dependent tests use `freezegun` to freeze time
- External API tests use `respx` mocks — never call real providers in unit/integration tests

---

## 7. CI Pipeline

### Pipeline Stages

```
1. Lint & Format
   ├── Backend: ruff check + ruff format --check
   ├── Frontend: eslint + prettier --check
   └── Block merge on failure

2. Type Check
   ├── Backend: mypy (strict mode)
   ├── Frontend: tsc --noEmit
   └── Block merge on failure

3. Unit Tests
   ├── Backend: pytest tests/unit/ --cov
   ├── Frontend: vitest run
   └── Block merge on failure or coverage below threshold

4. Integration Tests
   ├── Backend: pytest tests/integration/ (testcontainers)
   └── Block merge on failure

5. API Tests
   ├── Backend: pytest tests/api/ (testcontainers)
   └── Block merge on failure

6. E2E Tests (on merge to main only)
   ├── Frontend: playwright (against staging API)
   └── Notify on failure, don't block deploy

7. Build & Push
   ├── Docker build for each service
   ├── Push to ECR
   └── Deploy to staging
```

### Pre-Commit Hooks

```yaml
# Run locally before every commit
- ruff check --fix          # Python linting + auto-fix
- ruff format               # Python formatting
- mypy                      # Python type checking
- pytest tests/unit/ -x     # Run unit tests, stop on first failure
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

```python
# For each sport, test against known historical results:
# "Given this scoring config and these real stat events,
#  the engine should produce these exact scores and standings."

class TestGolfScoringAgainstRealData:
    """Validate golf scoring against 2025 Masters actual results."""

    def test_dfs_scoring_masters_2025(self, scoring_engine):
        config = SCORING_TEMPLATES["golf_dfs_standard"]
        stats = load_fixture("masters_2025_stats.json")
        results = scoring_engine.calculate(config, stats)
        # Verify top 10 scores match expected values
        assert results[0].participant_name == "Scottie Scheffler"
        assert results[0].total_points == pytest.approx(287.5, abs=0.1)

    def test_stroke_play_masters_2025(self, scoring_engine):
        config = SCORING_TEMPLATES["golf_stroke_pick6_use4"]
        # ... validate stroke play scoring
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

- **Locust** (Python-native load testing) or **k6** (JavaScript-based)
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
