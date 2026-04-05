# Smoke And E2E Strategic Expansion

> **Planning Note (2026-04-04):** Execute this plan only after the current CI/CD cleanup and stability pass are complete. Keep the existing minimal deploy-gate smoke/browser checks intact until the new suites prove reliable in repeated QA runs.

## Purpose

Build out the smoke-test and browser E2E layers in a deliberate way that increases confidence in real deployed behavior without recreating brittle, slow, low-signal suites.

This plan separates:

- **deploy-gate smoke**: small, black-box confidence checks that must stay reliable
- **expanded smoke coverage**: route/service verification that broadens production confidence without becoming a full regression suite
- **high-value browser E2E**: real multi-step user journeys that are split into independent flows and can run in parallel

## Strategic Goals

1. Make smoke cover the most important deployed routes, not just a tiny happy path.
2. Ensure the smoke layer touches at least one meaningful endpoint for every deployed service/app surface we expect QA to trust.
3. Rebuild browser E2E around real-world user journeys rather than page-load checks.
4. Keep E2E tests independent enough to run in parallel and fail diagnostically.
5. Avoid dependence on ambient seed fixtures by creating or sourcing test data explicitly.

## Non-Goals

- Do not move the full high-value E2E suite into the required deploy gate immediately.
- Do not rely on fake in-app data, injected browser state, or seed-only QA fixtures.
- Do not collapse smoke into a slow pseudo-regression suite.
- Do not combine multiple user journeys into one giant browser spec that is hard to debug.

## Current Baseline

Current required deploy checks:

- API smoke:
  - [tests/api/functional/mvp-baseline.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/mvp-baseline.smoke.ts)
  - [tests/api/functional/contest-lifecycle.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/api/functional/contest-lifecycle.smoke.ts)
- Browser sanity:
  - [clients/web/e2e/mvp-browser.smoke.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/e2e/mvp-browser.smoke.ts)

These should remain small until the new suites are proven.

## Principles

- Smoke tests should prove the deployed system is usable right now.
- Smoke tests should create their own minimum live data through real routes when possible.
- Browser E2E should use stable selectors and real user interactions.
- Every browser journey should own its own setup and teardown assumptions as much as practical.
- Prefer several shorter independent specs over one huge end-to-end mega-flow.
- A failing test should tell us which business capability is broken.
- Promote suites into required CI only after they are stable in a non-blocking lane.

## Service And Route Coverage Strategy

Before adding tests, build and maintain a **service-to-endpoint smoke inventory** for QA:

1. List every deployed QA-facing service/app surface.
2. Identify at least one meaningful endpoint or route per service.
3. Mark whether the check belongs in:
   - blocking smoke
   - non-blocking smoke expansion
   - browser E2E only

Minimum intended coverage target:

- **Web app**:
  - landing/auth route sanity
  - one authenticated dashboard or league route
- **Admin app**:
  - app shell load
  - one authenticated admin detail/list route
- **Core API**:
  - health
  - auth/profile
  - league
  - invitation/membership
  - contest
  - contest entry
  - draft/selection room
  - standings/results read
- **Additional deployed QA services**:
  - if a service is independently deployed and directly relied on in QA, smoke should hit at least one truthful endpoint or externally visible contract check for it

If `mock-contest-feed-provider` becomes a deployed QA dependency later, add one smoke endpoint for it only after it is actually in use by QA flows.

## Smoke Expansion Model

### Lane 1: Required Deploy-Gate Smoke

Keep this lane small and reliable.

It should answer:

> "Did the deployment produce a usable system for the main MVP path?"

Suggested long-term required deploy-gate checks:

1. health and authenticated profile
2. league create + invite generation
3. invite acceptance + membership visibility
4. contest create + read/update/delete
5. one contest entry or selection-room read
6. one standings/results read
7. web shell route sanity
8. admin shell route sanity

### Lane 2: Expanded Non-Blocking Smoke

Use this lane to broaden route/service confidence without turning the deploy gate into a bottleneck.

Suggested expanded smoke groups:

- **SMX-001 Auth and Identity**
  - register
  - login
  - current profile
  - token refresh or equivalent session continuity

- **SMX-002 League Operations**
  - create league
  - generate invite link
  - accept invite
  - list members
  - membership/role read

- **SMX-003 Contest Operations**
  - create contest
  - fetch contest detail
  - update contest
  - delete contest
  - list contests

- **SMX-004 Contest Entry and Draft**
  - enter contest
  - fetch room state
  - submit one supported selection
  - verify read-after-write room state

- **SMX-005 Standings and Results**
  - get standings
  - get standings summary or my-entry context
  - get results/history surface for the same contest where truthful

- **SMX-006 Web and Admin Surface Reachability**
  - web authenticated route sanity
  - admin authenticated route sanity
  - fail on runtime JS errors and visible error boundaries

## Browser E2E Rebuild Model

Create a separate high-value browser lane built from **independent real-world user flows**.

### E2E Design Rules

- One business journey per spec file where practical.
- Use separate users per scenario to avoid cross-test coupling.
- Prefer explicit setup helpers over implicit previous-test state.
- If a flow needs shared seeded infrastructure, that infrastructure must be deterministic and documented.
- Run specs in parallel; avoid one journey depending on another journey’s artifacts.

### Target Initial Journey Set

#### E2X-001 Commissioner League Setup

Flow:

1. register/login commissioner
2. create league
3. land on league detail
4. verify settings/members/feed entry points

Value:

- proves core onboarding and league creation

#### E2X-002 Invite And Join Flow

Flow:

1. commissioner creates league
2. commissioner generates invite link
3. second user accepts invite
4. commissioner sees joined member
5. member sees joined league

Value:

- proves the critical multi-user collaboration path

#### E2X-003 Contest Creation And Review

Flow:

1. commissioner creates league
2. commissioner creates supported MVP contest
3. configures contest settings
4. lands on contest detail
5. verifies standings/scoring/results tabs or surfaces render coherently

Value:

- proves the commissioner contest setup path end to end

#### E2X-004 Contest Entry And Draft Start

Flow:

1. user joins or enters an existing test-owned contest
2. opens entry or draft room
3. submits one supported pick/selection
4. verifies updated room/entry state

Value:

- proves the core participant value path

#### E2X-005 League Activity And Recap Read

Flow:

1. user opens league feed/history/recap
2. verifies expected read surfaces and navigation

Value:

- exercises high-value read experiences without requiring deep mutation chains

#### E2X-006 Admin Provider/Tenant Diagnostics

Flow:

1. admin logs in
2. visits provider list/detail
3. visits tenant list/detail
4. verifies error-free admin detail rendering

Value:

- gives browser confidence on the admin surface without dragging admin depth into the deploy gate

## Parallelization Strategy

To support parallel execution:

- each E2E spec should own its own users and primary resources
- shared fixture helpers should generate unique emails/names per spec
- avoid one global “commissioner account” reused across all specs
- avoid single shared contest IDs across specs
- group flows by isolated capability rather than by one giant narrative

Recommended parallel groups:

- Group A:
  - E2X-001 Commissioner League Setup
  - E2X-005 League Activity And Recap Read
- Group B:
  - E2X-002 Invite And Join Flow
- Group C:
  - E2X-003 Contest Creation And Review
- Group D:
  - E2X-004 Contest Entry And Draft Start
- Group E:
  - E2X-006 Admin Provider/Tenant Diagnostics

## Data Strategy

- Prefer self-created data through public routes wherever possible.
- For contest/draft/result journeys, use deterministic QA data infrastructure instead of seed hacks.
- If `mock-contest-feed-provider` is adopted in QA, use it to support contest creation and result-oriented browser/smoke flows.
- Keep test fixture catalogs out of application seed flows.

## Promotion Strategy

### Phase 1

- Keep current minimal smoke and browser deploy gate
- build expanded smoke in a non-blocking lane
- build high-value E2E in a non-blocking lane

### Phase 2

- measure flake rate and runtime
- fix selectors/data ownership issues
- promote the most stable expanded smoke cases into required CI

### Phase 3

- promote only the most stable 1-2 browser journeys into required CI if they remain fast and deterministic
- keep broader browser coverage as non-blocking QA verification

## Execution Slices

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| STX-001 | Inventory | Build QA service/endpoint smoke inventory and classify each check into required smoke, expanded smoke, or E2E only | Not Started | Include web, admin, core API, and any additional deployed QA service actually in use |
| STX-002 | Smoke | Extend required smoke to include one truthful contest entry/selection-room read and one standings/results read | Not Started | Promote only when deterministic |
| STX-003 | Smoke | Build expanded non-blocking smoke route matrix for auth, league, invite, contest, entry, standings, and admin/web reachability | Not Started | Organize by capability, not by arbitrary files |
| STX-004 | E2E | Implement commissioner league setup journey | In Progress | First pass now covers seeded commissioner login plus league member management reachability against QA |
| STX-005 | E2E | Implement invite and member join journey | Not Started | Use two self-owned users and a real invite link |
| STX-006 | E2E | Implement contest creation and review journey | Not Started | Use supported MVP contest types only |
| STX-007 | E2E | Implement contest entry and draft-start journey | Not Started | Use deterministic setup data and one supported selection path |
| STX-008 | E2E | Implement league activity/history/recap read journey | Not Started | Keep this read-focused and stable |
| STX-009 | E2E | Implement admin provider/tenant browser diagnostics journey | In Progress | First pass now covers seeded admin login plus provider list reachability against QA |
| STX-010 | CI | Add non-blocking CI lane(s) for expanded smoke and high-value browser flows with artifacts/traces | In Progress | First pass now runs web and admin Playwright diagnostics in the deployed lane with artifacts |
| STX-011 | Promotion | Promote only the proven stable subset into required CI | Not Started | Base promotion on repeated green runs and low flake rate |

## Acceptance Criteria

- Smoke covers the most important MVP routes and touches at least one meaningful endpoint per deployed QA service/app surface.
- Browser E2E covers real multi-step user journeys rather than page-render checks alone.
- High-value browser tests are split into independent specs that can run in parallel.
- Required deploy-gate suites stay small and reliable.
- Richer smoke/E2E coverage is introduced through staged promotion, not all at once.
