# PoolMaster — Smoke Test Suites Plan

> **Rules:** Testing standards follow [Testing Rules](../../rules/testing-rules.md). Architecture follows [Architecture Rules](../../rules/architecture-rules.md).

---

## 1. Overview

Two independent smoke test suites that validate PoolMaster end-to-end as a **deployed product**, not as part of the build pipeline. Both suites simulate real user workflows: creating leagues, configuring contests across every sport/type/draft combination, drafting squads, scoring with mock data, and determining winners.

| Suite | Layer | Tool | Target | Trigger |
|---|---|---|---|---|
| **API Smoke Tests** | Service layer only | Vitest + `fetch`/`undici` | Deployed API (staging, production) | On-demand, post-deploy, scheduled |
| **UI Smoke Tests** | Web app + service layer | Playwright | Deployed webapp + API | On-demand, post-deploy, scheduled |

**Key design principle:** These suites are **external black-box tests**. They run against deployed environments, never start local services, and never import application code. They live in their own directory with their own `package.json`, completely separate from the build.

---

## 2. Directory Structure

```
smoke-tests/                          # Top-level, NOT inside packages/ or tests/
├── package.json                      # Independent deps (vitest, playwright, undici, faker)
├── tsconfig.json
├── vitest.config.ts                  # API suite config
├── playwright.config.ts              # UI suite config
├── .env.example                      # BASE_URL, AUTH credentials, etc.
├── README.md                         # Setup, running, CI integration
│
├── shared/                           # Shared across both suites
│   ├── config.ts                     # Env-driven config (base URLs, timeouts)
│   ├── auth.ts                       # Login helper — obtain JWT/session for API calls
│   ├── api-client.ts                 # Typed HTTP client wrapping fetch/undici
│   ├── fixtures/                     # Mock sports data for scoring
│   │   ├── golf-tournament.json      # Field, rounds, scores for a mock tournament
│   │   ├── nfl-week.json             # Teams, player stats for a mock NFL week
│   │   ├── nba-game.json             # Teams, player stats for a mock NBA game
│   │   ├── f1-race.json              # Drivers, positions, laps for a mock race
│   │   ├── nascar-race.json          # Drivers, positions for a mock race
│   │   ├── ncaa-tournament.json      # Bracket, game results for mock March Madness
│   │   ├── tennis-match.json         # Players, sets, match result
│   │   ├── horse-racing-event.json   # Horses, positions, race result
│   │   ├── soccer-match.json         # Teams, player stats, match result
│   │   └── ufc-card.json             # Fighters, bout results, methods
│   ├── helpers/
│   │   ├── league.ts                 # createLeague(), inviteMembers(), acceptInvite()
│   │   ├── contest.ts                # createContest(), configurePool(), lockPool()
│   │   ├── draft.ts                  # startDraft(), makeRandomPicks(), completeDraft()
│   │   ├── scoring.ts                # submitScores(), recalculate(), getStandings()
│   │   ├── user.ts                   # registerUser(), loginUser(), getProfile()
│   │   └── cleanup.ts               # deleteContest(), deleteLeague() (teardown)
│   └── data/
│       ├── sports-matrix.ts          # All sport × contest-type × draft-style combos
│       └── user-pool.ts              # Pre-seeded test user credentials
│
├── api/                              # Suite 1: API-only smoke tests
│   ├── setup.ts                      # Global setup (auth, base URL verification)
│   ├── teardown.ts                   # Global teardown (cleanup created resources)
│   ├── health.test.ts                # Service health checks
│   ├── league-lifecycle.test.ts      # Create → configure → invite → accept → roles
│   ├── contest-creation.test.ts      # Create one contest per sport × type × draft
│   ├── pool-management.test.ts       # Pool creation, participant management, pricing
│   ├── draft-execution.test.ts       # Run drafts for each draft style
│   ├── scoring-lifecycle.test.ts     # Submit mock data, score, determine winners
│   ├── commissioner-actions.test.ts  # Overrides, pause/resume, score adjustments
│   └── full-workflow.test.ts         # End-to-end: league → contest → draft → score → winners
│
├── ui/                               # Suite 2: UI (Playwright) smoke tests
│   ├── setup.ts                      # Global setup (browser launch, auth state)
│   ├── teardown.ts                   # Global teardown
│   ├── auth.spec.ts                  # Register, login, logout flows
│   ├── league-creation.spec.ts       # Create league via wizard UI
│   ├── member-management.spec.ts     # Invite, accept, manage roles via UI
│   ├── contest-wizard.spec.ts        # Create contests via wizard for each sport
│   ├── draft-room.spec.ts            # Join draft room, make picks, complete draft
│   ├── standings.spec.ts             # View standings, results after scoring
│   ├── commissioner-dashboard.spec.ts # Commissioner overrides via UI
│   └── full-workflow.spec.ts         # End-to-end UI flow: register → league → contest → draft → results
│
└── scripts/
    ├── run-api.sh                    # Run API smoke tests against a target env
    ├── run-ui.sh                     # Run UI smoke tests against a target env
    └── seed-test-users.ts            # One-time script to create test user accounts
```

---

## 3. Environment Configuration

Both suites are configured entirely via environment variables. No hardcoded URLs or credentials.

```env
# Target environment
SMOKE_API_BASE_URL=https://api.staging.poolmaster.io
SMOKE_WEB_BASE_URL=https://staging.poolmaster.io

# Test user accounts (pre-seeded)
SMOKE_COMMISSIONER_EMAIL=smoke-commissioner@test.poolmaster.io
SMOKE_COMMISSIONER_PASSWORD=<secure>
SMOKE_MEMBER_1_EMAIL=smoke-member-1@test.poolmaster.io
SMOKE_MEMBER_1_PASSWORD=<secure>
SMOKE_MEMBER_2_EMAIL=smoke-member-2@test.poolmaster.io
SMOKE_MEMBER_2_PASSWORD=<secure>
SMOKE_MEMBER_3_EMAIL=smoke-member-3@test.poolmaster.io
SMOKE_MEMBER_3_PASSWORD=<secure>

# Timeouts
SMOKE_API_TIMEOUT_MS=10000
SMOKE_UI_TIMEOUT_MS=30000
SMOKE_DRAFT_POLL_INTERVAL_MS=500

# Cleanup
SMOKE_CLEANUP_AFTER_RUN=true
```

---

## 4. Sports × Contest Type × Draft Style Matrix

Every combination below gets a dedicated contest created, drafted, scored, and resolved. This is the core coverage matrix.

### 4.1 Sport → Contest Types

| Sport | SINGLE_EVENT | SEASON_LONG |
|---|---|---|
| GOLF | ✅ Major tournament | ✅ Season-long tour |
| NFL | ✅ Single week | ✅ Full season |
| NBA | ✅ Single game | ✅ Full season |
| NHL | ✅ Single game | ✅ Full season |
| MLB | ✅ Single game | ✅ Full season |
| F1 | ✅ Single race | ✅ Championship season |
| NASCAR | ✅ Single race | ✅ Cup series season |
| NCAA_BASKETBALL | ✅ Tournament | ✅ Season |
| NCAA_HOCKEY | ✅ Tournament | ✅ Season |
| NCAA_FOOTBALL | ✅ Bowl game/playoff | ✅ Season |
| TENNIS | ✅ Grand Slam | ✅ Season-long tour |
| HORSE_RACING | ✅ Single race day | ✅ Triple Crown series |
| SOCCER | ✅ Single match | ✅ League season |
| UFC | ✅ Fight card | ✅ Season |

### 4.2 Selection Type → Compatible Scoring Engines

| Selection Type | Scoring Engines Used | Draft Styles Tested |
|---|---|---|
| SNAKE_DRAFT | STAT_ACCUMULATION, ADVANCEMENT, STROKE_PLAY, POSITION | LIVE, ASYNC |
| TIERED | STAT_ACCUMULATION, ADVANCEMENT, POSITION | N/A (pick from tiers) |
| BUDGET_PICK | STAT_ACCUMULATION, ADVANCEMENT | N/A (pick within budget) |
| OPEN_SELECTION | STAT_ACCUMULATION, STROKE_PLAY, POSITION | N/A (unrestricted) |
| PICK_EM | CUMULATIVE | N/A (predict outcomes) |
| BRACKET_PICK_EM | BRACKET | N/A (fill bracket) |

### 4.3 Priority Test Combinations (minimum set)

At minimum the smoke tests create **one contest per sport per selection type** where the combination is valid. The full matrix yields approximately **70-80 contests** per run. To keep runtime manageable, tests are organized so that:

1. **One league** is created with all members invited and joined
2. **Contests are created in parallel** (API suite) or sequentially (UI suite)
3. **Drafts run sequentially** per contest (drafting is stateful)
4. **Scoring uses pre-built fixture data** — no live data dependency

---

## 5. Suite 1: API Smoke Tests

### 5.1 Technology

| Concern | Choice | Why |
|---|---|---|
| Test runner | Vitest | Fast, TypeScript-native, good reporter output |
| HTTP client | undici (fetch) | Zero-dep, native Node.js, supports streaming |
| Assertions | Vitest built-in (`expect`) | Consistent with runner |
| Data generation | @faker-js/faker | Realistic test names, emails |
| Retry | Built-in Vitest retry | Flaky network tolerance |
| Reporting | vitest-junit-reporter | CI-compatible output |

### 5.2 Test Structure & Flow

#### `health.test.ts` — Service Health Checks
```
✓ core-api /health returns 200
✓ draft-service /health returns 200
✓ scoring-service /health returns 200
✓ ingestion-worker /health returns 200
✓ notification-service /health returns 200
```

#### `league-lifecycle.test.ts` — League CRUD + Membership
```
✓ Commissioner creates a private league
✓ Commissioner updates league settings (timezone, currency)
✓ Commissioner generates invite link
✓ Member 1 accepts invite link and joins
✓ Commissioner sends email invitations to Members 2 and 3
✓ Members 2 and 3 accept email invitations
✓ Commissioner promotes Member 1 to MANAGER role
✓ GET league returns all 4 members with correct roles
✓ Commissioner dashboard shows league with 4 members
```

#### `contest-creation.test.ts` — Contest per Sport × Type × Draft
For each valid combination in the sports matrix:
```
✓ Creates contest: {sport} / {contestType} / {selectionType} / {scoringEngine}
✓ Contest status is DRAFT
✓ Contest config matches creation payload
✓ Contest appears in league contest list
```

#### `pool-management.test.ts` — Participant Pool Setup
For each created contest:
```
✓ Creates participant pool (EVENT_FIELD or CUSTOM based on sport)
✓ Adds participants from fixture data
✓ Calculates pricing (for BUDGET_PICK and TIERED contests)
✓ Assigns tiers (for TIERED contests)
✓ Locks pool
✓ Opens contest for entry (status → OPEN)
```

#### `draft-execution.test.ts` — Drafting All Contests
For each contest by selection type:

**SNAKE_DRAFT contests:**
```
✓ All members join the contest
✓ Draft starts (status → DRAFTING)
✓ Each member makes picks in snake order
✓ Auto-pick fires if pick timer expires (optional — test with one timeout)
✓ Draft completes (status → LOCKED)
✓ Each member's squad has the correct number of picks
```

**TIERED contests:**
```
✓ All members join the contest
✓ Each member selects one participant per tier
✓ Selections are non-exclusive (multiple members can pick same participant)
✓ Contest locks after all members submit
```

**BUDGET_PICK contests:**
```
✓ All members join the contest
✓ Each member builds a roster within budget
✓ Over-budget roster is rejected (400)
✓ Contest locks after all members submit
```

**OPEN_SELECTION contests:**
```
✓ All members join the contest
✓ Each member picks N participants from unrestricted field
✓ Contest locks after all members submit
```

**PICK_EM contests:**
```
✓ All members join the contest
✓ Each member submits predictions for all matchups
✓ Contest locks after all members submit
```

**BRACKET_PICK_EM contests:**
```
✓ All members join the contest
✓ Each member fills out a complete bracket
✓ Contest locks after all members submit
```

#### `scoring-lifecycle.test.ts` — Score & Determine Winners
For each contest:
```
✓ Mock player/team stat data is submitted via scoring API
✓ Scoring recalculation is triggered
✓ Standings endpoint returns ranked entries
✓ Winner has the highest score (or lowest for STROKE_PLAY)
✓ Contest status transitions to COMPLETED
✓ Payout distribution matches configured rules
✓ Results endpoint returns final standings with payout amounts
```

#### `commissioner-actions.test.ts` — Commissioner Overrides
```
✓ Commissioner pauses an active draft
✓ Commissioner resumes the paused draft
✓ Commissioner undoes the last pick in a draft
✓ Commissioner adjusts a member's score by +/- amount
✓ Commissioner triggers recalculation after adjustment
✓ Commissioner reopens a completed contest
✓ Commissioner closes and confirms payouts
✓ Audit log records all commissioner actions
```

#### `full-workflow.test.ts` — End-to-End Happy Path
One complete flow for a single sport (GOLF, SNAKE_DRAFT, STROKE_PLAY):
```
1. Commissioner registers/logs in
2. Commissioner creates league "Smoke Test Masters"
3. Commissioner invites 3 members
4. All members accept invitations
5. Commissioner creates golf stroke-play contest
6. Commissioner creates participant pool from fixture data
7. Commissioner sets pricing and locks pool
8. Commissioner opens contest
9. All 4 members join the contest
10. Snake draft starts
11. Each member drafts 4 golfers over 4 rounds
12. Draft completes, squads locked
13. Mock tournament round data is submitted (4 rounds)
14. Scoring engine calculates total strokes per squad
15. Standings show winner (lowest total strokes)
16. Contest marked COMPLETED
17. Commissioner confirms payouts
18. Results and history endpoints return correct data
```

### 5.3 Running

```bash
# From smoke-tests/ directory
# Run against staging
SMOKE_API_BASE_URL=https://api.staging.poolmaster.io npm run test:api

# Run against production
SMOKE_API_BASE_URL=https://api.poolmaster.io npm run test:api

# Run a specific test file
npm run test:api -- --filter health

# Run with verbose output
npm run test:api -- --reporter verbose
```

---

## 6. Suite 2: UI Smoke Tests (Playwright)

### 6.1 Technology

| Concern | Choice | Why |
|---|---|---|
| E2E framework | Playwright | Cross-browser, fast, built-in waits, good TypeScript support |
| Browsers | Chromium (primary), Firefox, WebKit (optional) | Chrome covers most users; others for cross-browser confidence |
| Auth state | Playwright `storageState` | Login once, reuse session across tests |
| Screenshots | On failure (auto) | Debugging failed runs |
| Video | On failure (auto) | Debugging complex flows |
| Reporting | HTML reporter + JUnit XML | Human-readable + CI-compatible |

### 6.2 Page Object Models

```
ui/pages/
├── login.page.ts            # Login form interactions
├── register.page.ts         # Registration form
├── dashboard.page.ts        # Dashboard — leagues list, active contests, upcoming drafts
├── league-create.page.ts    # League creation wizard
├── league-detail.page.ts    # League overview, member list
├── league-settings.page.ts  # League settings form
├── contest-wizard.page.ts   # Contest creation wizard (multi-step)
├── contest-detail.page.ts   # Contest overview, standings
├── contest-results.page.ts  # Final results & payouts
├── draft-room.page.ts       # Draft room — pick board, timer, squad tracker
├── member-invite.page.ts    # Invitation management
└── commissioner-dashboard.page.ts  # Commissioner action items
```

### 6.3 Test Structure & Flow

#### `auth.spec.ts` — Authentication Flows
```
✓ New user registers with email and password
✓ Registered user logs in successfully
✓ Login with wrong password shows error
✓ User sees dashboard after login
✓ User logs out and is redirected to login page
```

#### `league-creation.spec.ts` — Create League via UI
```
✓ Commissioner navigates to /leagues/create
✓ Fills in league name, description, visibility (PRIVATE)
✓ Submits form and is redirected to new league page
✓ League appears in commissioner's /leagues list
✓ League settings page shows correct configuration
```

#### `member-management.spec.ts` — Invitations & Roles via UI
```
✓ Commissioner generates invite link from league settings
✓ Member 1 opens invite link and joins league
✓ Commissioner sends email invites from member management page
✓ Members page shows all members with correct roles
✓ Commissioner changes a member's role via dropdown
```

#### `contest-wizard.spec.ts` — Create Contests via Wizard
For each sport (one contest per sport, primary selection type):
```
✓ Commissioner navigates to /contests/create
✓ Selects sport: {sport}
✓ Selects contest type: {SINGLE_EVENT or SEASON_LONG}
✓ Selects selection type: {primary selection type for sport}
✓ Configures scoring engine
✓ Sets payout structure
✓ Submits wizard and contest is created
✓ Contest detail page shows correct configuration
```

#### `draft-room.spec.ts` — Live Draft via UI
For one snake draft contest (golf):
```
✓ Commissioner opens contest and starts draft
✓ All members navigate to /drafts/:draftId
✓ Draft room shows available participants, pick timer, and draft order
✓ Current picker sees "Your Pick" indicator
✓ Picker selects a participant and confirms pick
✓ Pick appears in squad tracker for that member
✓ Next picker is notified
✓ Draft progresses through all rounds
✓ Draft completes and shows results summary
✓ Each member's squad is visible on results page
```

For one tiered contest:
```
✓ Members navigate to contest entry page
✓ Each tier shows available participants
✓ Member selects one participant per tier
✓ Submission succeeds, entry is locked
```

For one bracket contest (NCAA):
```
✓ Members navigate to bracket entry page
✓ Bracket shows all matchups in correct rounds
✓ Member clicks to select winners through each round
✓ Complete bracket submission succeeds
```

#### `standings.spec.ts` — Standings & Results via UI
```
✓ Contest standings page shows current rankings
✓ Each entry shows member name, squad, and score
✓ After contest completes, results page shows final standings
✓ Payout amounts are displayed for winning entries
✓ Member can view their own entry detail (squad + scoring breakdown)
```

#### `commissioner-dashboard.spec.ts` — Commissioner Actions via UI
```
✓ Commissioner sees action items on dashboard
✓ Commissioner pauses an active draft from the draft room
✓ Commissioner resumes the draft
✓ Commissioner adjusts a score from the contest detail page
✓ Commissioner confirms payouts from results page
```

#### `full-workflow.spec.ts` — End-to-End UI Happy Path
One complete browser-driven flow:
```
1. Commissioner registers a new account
2. Commissioner creates league "UI Smoke League"
3. Commissioner invites 3 members via invite link
4. (Switch browser context) Members accept and join
5. Commissioner creates a Golf snake-draft contest via wizard
6. Commissioner configures pool and opens contest
7. All members enter the contest
8. Draft starts — all 4 members make picks in the draft room
9. Draft completes, squads are locked
10. (Scoring data submitted via API helper — not a UI action)
11. All members view standings page — scores are populated
12. Contest completes — results page shows winner and payouts
13. Commissioner confirms payouts
14. Members view their contest history and earnings
```

### 6.4 Running

```bash
# From smoke-tests/ directory
# Run against staging
SMOKE_WEB_BASE_URL=https://staging.poolmaster.io \
SMOKE_API_BASE_URL=https://api.staging.poolmaster.io \
npm run test:ui

# Run headed (visible browser)
npm run test:ui -- --headed

# Run specific test
npm run test:ui -- --grep "league-creation"

# Run against specific browser
npm run test:ui -- --project chromium

# View HTML report after run
npx playwright show-report
```

---

## 7. Mock Scoring Data Strategy

Smoke tests must not depend on live sports data. Each sport has a **fixture file** with realistic but static data that the scoring engine can process.

### 7.1 Fixture Design per Sport

| Sport | Fixture File | Contents | Scoring Validated |
|---|---|---|---|
| GOLF | `golf-tournament.json` | 30 golfers, 4 rounds of stroke data, made/missed cuts | STROKE_PLAY: total strokes; ADVANCEMENT: cut progression |
| NFL | `nfl-week.json` | 16 teams, key player stats (passing, rushing, receiving, defense) | STAT_ACCUMULATION: fantasy scoring; ADVANCEMENT: win/loss |
| NBA | `nba-game.json` | 2 teams, 15 players each with game stats | STAT_ACCUMULATION: fantasy scoring |
| F1 | `f1-race.json` | 20 drivers, qualifying + race positions, DNFs | POSITION: finish position points |
| NASCAR | `nascar-race.json` | 40 drivers, finish positions, laps led, DNFs | POSITION: finish position points |
| NCAA_BASKETBALL | `ncaa-tournament.json` | 64-team bracket, game results per round | BRACKET: correct pick points; ADVANCEMENT: round progression |
| TENNIS | `tennis-match.json` | 32 players, match results through tournament rounds | ADVANCEMENT: round progression |
| HORSE_RACING | `horse-racing-event.json` | 12 horses per race, 3 races, finish positions | POSITION: finish position points |
| SOCCER | `soccer-match.json` | 2 teams, 22 players with match stats | STAT_ACCUMULATION: goals, assists, clean sheets |
| UFC | `ufc-card.json` | 6 bouts, fighters, results with methods (KO/Sub/Dec) | FIGHT_RESULT: method-based points |

### 7.2 How Scoring Works in Smoke Tests

1. Contest is created and drafted (members have squads/picks)
2. Test submits fixture data via `POST /contests/:id/scoring/recalculate` or the scoring service ingestion endpoint
3. Test polls standings until scores are populated
4. Test asserts:
   - All entries have non-zero scores (unless a squad was all DNFs)
   - Rankings are ordered correctly (highest first, or lowest for stroke play)
   - Winner matches expected winner based on fixture data
   - Payout distribution is correct

---

## 8. Test Data Management

### 8.1 Test Users

Pre-seeded accounts in each target environment via `scripts/seed-test-users.ts`:

| Role | Email | Purpose |
|---|---|---|
| Commissioner | `smoke-commissioner@test.poolmaster.io` | Creates leagues, contests, runs overrides |
| Member 1 | `smoke-member-1@test.poolmaster.io` | Joins leagues, drafts, participates |
| Member 2 | `smoke-member-2@test.poolmaster.io` | Joins leagues, drafts, participates |
| Member 3 | `smoke-member-3@test.poolmaster.io` | Joins leagues, drafts, participates |

### 8.2 Cleanup Strategy

Every smoke test run creates resources (leagues, contests, entries). Cleanup happens:

1. **After each run** (default): `teardown.ts` deletes all resources created during the run, tracked by a `createdResources` registry
2. **Naming convention**: All smoke-test-created resources are prefixed with `[SMOKE]` for easy identification and manual cleanup
3. **Orphan cleanup**: A weekly scheduled job can delete any `[SMOKE]`-prefixed resources older than 24 hours

### 8.3 Idempotency

Tests should be safe to run repeatedly without manual intervention:
- Each run creates fresh leagues and contests (unique names with timestamps)
- Tests do not depend on resources from previous runs
- Cleanup removes everything created in the current run

---

## 9. CI/CD Integration

These suites run **outside** the main build pipeline. They are triggered post-deployment.

### 9.1 Trigger Points

| Trigger | Suite | Environment |
|---|---|---|
| Post-deploy to staging | API + UI | Staging |
| Post-deploy to production | API only (fast) | Production |
| Nightly schedule (2 AM UTC) | API + UI | Staging |
| Manual (on-demand) | Either | Any |

### 9.2 GitHub Actions Workflow

```yaml
name: Smoke Tests
on:
  workflow_dispatch:
    inputs:
      suite:
        type: choice
        options: [api, ui, both]
      environment:
        type: choice
        options: [staging, production]
  workflow_call:  # Called by deploy workflow
    inputs:
      suite:
        type: string
      environment:
        type: string
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM UTC

jobs:
  api-smoke:
    if: inputs.suite != 'ui'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd smoke-tests && npm ci
      - run: cd smoke-tests && npm run test:api
    env:
      SMOKE_API_BASE_URL: ${{ vars[format('SMOKE_API_URL_{0}', inputs.environment)] }}
      # ... credentials from secrets

  ui-smoke:
    if: inputs.suite != 'api'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd smoke-tests && npm ci
      - run: npx playwright install --with-deps chromium
      - run: cd smoke-tests && npm run test:ui
    env:
      SMOKE_WEB_BASE_URL: ${{ vars[format('SMOKE_WEB_URL_{0}', inputs.environment)] }}
      SMOKE_API_BASE_URL: ${{ vars[format('SMOKE_API_URL_{0}', inputs.environment)] }}
```

### 9.3 Alerting

- **On failure:** Slack notification to `#deploys` channel with failure summary and link to report
- **Playwright artifacts:** Screenshots, videos, and traces uploaded on failure
- **API test output:** JUnit XML uploaded to CI for test result tracking

---

## 10. Performance & Timeout Guidelines

| Operation | Expected Duration | Timeout |
|---|---|---|
| Health check | < 1s | 5s |
| League creation + setup | < 3s | 10s |
| Contest creation | < 2s | 10s |
| Pool setup + lock | < 5s | 15s |
| Single draft pick (API) | < 1s | 5s |
| Full snake draft (4 members, 4 rounds = 16 picks) | < 10s | 30s |
| Scoring recalculation | < 5s | 15s |
| Full API suite | < 10 min | 15 min |
| UI page load | < 3s | 10s |
| Draft room WebSocket connect | < 2s | 10s |
| Full UI suite | < 20 min | 30 min |

---

## 11. Implementation Phases

### Phase 1 — Infrastructure & Scaffolding
Set up the `smoke-tests/` project, dependencies, config, auth helpers, and the shared API client. Verify connectivity against a target environment.

### Phase 2 — Shared Helpers & Fixture Data
Build the helper functions (league, contest, draft, scoring) and create fixture JSON files for all 10 sports. Build the sports matrix data structure.

### Phase 3 — API Smoke Tests (Core)
Implement health checks, league lifecycle, contest creation across the full matrix, and pool management tests.

### Phase 4 — API Smoke Tests (Draft & Scoring)
Implement draft execution for all selection types and scoring lifecycle tests using fixture data. Implement the full end-to-end workflow test.

### Phase 5 — API Smoke Tests (Commissioner & Edge Cases)
Implement commissioner action tests and any additional edge case coverage.

### Phase 6 — UI Smoke Tests (Setup & Auth)
Set up Playwright, configure browsers, implement page object models, and build auth flow tests.

### Phase 7 — UI Smoke Tests (Workflows)
Implement league creation, contest wizard, draft room, standings, and commissioner dashboard UI tests.

### Phase 8 — UI Smoke Tests (Full E2E)
Implement the full end-to-end UI workflow test and cross-browser validation.

### Phase 9 — CI/CD Integration & Alerting
Set up GitHub Actions workflows, Slack alerting, artifact uploads, and nightly scheduling.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| ST-001 | 1 | Create `smoke-tests/` directory with `package.json`, `tsconfig.json`, Vitest and Playwright configs | Not Started | |
| ST-002 | 1 | Create `.env.example` and `shared/config.ts` with env-driven configuration | Not Started | |
| ST-003 | 1 | Implement `shared/auth.ts` — login helper that obtains JWT from deployed auth endpoint | Not Started | |
| ST-004 | 1 | Implement `shared/api-client.ts` — typed HTTP wrapper (GET, POST, PUT, DELETE with auth headers) | Not Started | |
| ST-005 | 1 | Write `api/health.test.ts` to validate connectivity to all 5 services | Not Started | Validates infra before running full suite |
| ST-006 | 2 | Implement `shared/helpers/user.ts` — registerUser, loginUser, getProfile | Not Started | |
| ST-007 | 2 | Implement `shared/helpers/league.ts` — createLeague, inviteMembers, acceptInvite, cleanup | Not Started | |
| ST-008 | 2 | Implement `shared/helpers/contest.ts` — createContest, configurePool, lockPool, cleanup | Not Started | |
| ST-009 | 2 | Implement `shared/helpers/draft.ts` — startDraft, makeRandomPicks, completeDraft | Not Started | |
| ST-010 | 2 | Implement `shared/helpers/scoring.ts` — submitScores, recalculate, getStandings | Not Started | |
| ST-011 | 2 | Build `shared/data/sports-matrix.ts` — all valid sport × contestType × selectionType × scoringEngine combos | Not Started | |
| ST-012 | 2 | Create fixture JSON files for all 10 sports (golf, NFL, NBA, F1, NASCAR, NCAA, tennis, horse racing, soccer, UFC) | Not Started | |
| ST-013 | 2 | Create `shared/data/user-pool.ts` and `scripts/seed-test-users.ts` | Not Started | |
| ST-014 | 2 | Implement `shared/helpers/cleanup.ts` — resource registry and teardown logic | Not Started | |
| ST-015 | 3 | Implement `api/league-lifecycle.test.ts` — create, configure, invite, accept, roles | Not Started | |
| ST-016 | 3 | Implement `api/contest-creation.test.ts` — create one contest per sport × type × draft combo | Not Started | Uses sports matrix |
| ST-017 | 3 | Implement `api/pool-management.test.ts` — pool creation, participants, pricing, tiers, lock | Not Started | |
| ST-018 | 4 | Implement `api/draft-execution.test.ts` — snake draft with random picks for all members | Not Started | |
| ST-019 | 4 | Implement `api/draft-execution.test.ts` — tiered, budget, open selection, pick'em, bracket picks | Not Started | |
| ST-020 | 4 | Implement `api/scoring-lifecycle.test.ts` — submit fixture data, recalculate, validate standings | Not Started | |
| ST-021 | 4 | Implement `api/full-workflow.test.ts` — end-to-end golf snake draft from league to payouts | Not Started | |
| ST-022 | 5 | Implement `api/commissioner-actions.test.ts` — pause, resume, undo pick, adjust score, reopen, confirm payouts | Not Started | |
| ST-023 | 5 | Add negative test cases — invalid contest configs, over-budget picks, unauthorized access | Not Started | |
| ST-024 | 6 | Configure Playwright — browsers, base URL, storage state, screenshot/video on failure | Not Started | |
| ST-025 | 6 | Implement page object models for all key pages (login, dashboard, league, contest, draft room) | Not Started | |
| ST-026 | 6 | Implement `ui/auth.spec.ts` — register, login, logout, error states | Not Started | |
| ST-027 | 7 | Implement `ui/league-creation.spec.ts` — create league via wizard UI | Not Started | |
| ST-028 | 7 | Implement `ui/member-management.spec.ts` — invite, accept, manage roles via UI | Not Started | |
| ST-029 | 7 | Implement `ui/contest-wizard.spec.ts` — create one contest per sport via wizard | Not Started | |
| ST-030 | 7 | Implement `ui/draft-room.spec.ts` — join draft room, make picks, complete draft | Not Started | WebSocket testing |
| ST-031 | 7 | Implement `ui/standings.spec.ts` — view standings, results, payouts | Not Started | |
| ST-032 | 7 | Implement `ui/commissioner-dashboard.spec.ts` — commissioner overrides via UI | Not Started | |
| ST-033 | 8 | Implement `ui/full-workflow.spec.ts` — end-to-end from register to payouts in browser | Not Started | Multi-browser-context test |
| ST-034 | 8 | Validate UI suite on Firefox and WebKit browsers | Not Started | |
| ST-035 | 9 | Create GitHub Actions workflow for smoke tests (manual, post-deploy, nightly triggers) | Not Started | |
| ST-036 | 9 | Configure Slack alerting on smoke test failure | Not Started | |
| ST-037 | 9 | Configure artifact uploads — Playwright traces, screenshots, videos, JUnit XML | Not Started | |
| ST-038 | 9 | Write `smoke-tests/README.md` with setup instructions, running locally, CI integration | Not Started | |
