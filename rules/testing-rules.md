# PoolMaster — Testing Rules

All services and clients must follow these testing standards. This document defines the testing strategy, contract validation rules, smoke/E2E expectations, and when old tests should be removed rather than preserved.

> **Architecture dependency:** This document assumes the stack in [architecture-rules.md](architecture-rules.md): Fastify + TypeScript backend, React web/admin clients, native iOS/Android clients, DTO-driven OpenAPI, and shared generated `hey-api` clients for web/admin.

---

## 1. Testing Tools

### Backend

| Tool | Purpose |
|---|---|
| Jest | unit and integration test runner |
| Fastify `inject` | request/response integration testing |
| Prisma test DB / local infra | persistence-backed integration tests |
| `nock` / service mocks | external dependency isolation where needed |

### Frontend — Web/Admin

| Tool | Purpose |
|---|---|
| Vitest | unit and integration-style test runner |
| React Testing Library | user-focused component and page tests |
| MSW | request-level API mocking |
| Playwright | browser smoke/E2E tests |

### Mobile

| Platform | Tooling |
|---|---|
| iOS | XCTest / XCUITest |
| Android | JUnit / Compose UI tests / instrumentation where needed |

---

## 2. Test Layers

### Backend

| Layer | Scope | Real DB | Notes |
|---|---|---|---|
| Unit | function/service behavior | no | mock dependencies intentionally |
| Integration | Fastify + services + persistence | yes | validates real behavior; if the test needs a local Postgres instance that is not reachable from the sandbox/container, run it outside the sandbox with explicit user permission |
| Contract | response/request shape vs DTO schema | yes | catches drift |
| Smoke | deployed API black-box flow | deployed env | post-build/post-deploy confidence |

### Frontend

| Layer | Scope | API |
|---|---|---|
| Unit | presentational components, utilities | mocked only if network irrelevant |
| Integration | hooks/pages/user flows | MSW |
| Browser E2E | deployed browser flows | real deployed API |

---

## 3. Required Local Quality Gates

These are the default required checks before commit:

1. `npx turbo typecheck --force`
2. `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
3. `npx jest --config tests/jest.config.js --forceExit`
4. `cd clients/web && npx vitest run`
5. `cd clients/admin && npx vitest run`

Contract-specific commands:

6. `npm run api:refresh` when API schemas change
7. `npm run api:validate` when OpenAPI output changes

Notes:

- DB-backed integration tests may need to run outside the Codex sandbox/container when they depend on a developer-local Postgres instance such as `localhost:5432`.
- In those cases, ask for permission and run the exact integration command outside the sandbox rather than treating the failure as an application defect.

---

## 4. Contract Testing Rules

PoolMaster treats API contracts as first-class test surfaces.

- Contract tests must validate live responses against DTO Zod schemas using `.safeParse()`.
- New or changed endpoints must update:
  - `tests/integration/core-api/api-contracts-web.integration.ts`
  - `tests/integration/core-api/api-contracts-admin.integration.ts`
  - or a clearly equivalent contract suite
- If response shape changes, update the contract test in the same change.
- Do not rely on TypeScript alone to prove runtime payload shape correctness.

---

## 5. MSW Rules

MSW is the default pattern for frontend tests that should exercise real request wiring.

Use MSW when testing:

- hooks
- pages
- form submission flows
- authenticated screen loading
- query/mutation behavior

Why:

- the real API layer executes
- the real URL/method/body gets constructed
- path drift and request-shape drift are caught

### Banned Frontend Test Patterns

- `vi.mock('@/lib/api-client')`
- mocking the generated API layer so completely that request construction never runs
- tests that only assert copied path strings
- preserving old tests that validate retired manual-client behavior
- broad MSW rewrites that silently expand into unrelated feature slices without explicit approval

### Allowed Cleanup

Remove tests if they are:

- enforcing obsolete manual API wrappers
- built around fake application fallback data that no longer exists
- lower-signal duplicates of stronger MSW/contract coverage

Do not keep bad tests just because they already exist.
Before deleting an existing test suite for architecture/strategy reasons, confirm with the user first unless they already explicitly asked for that deletion category in the current thread.

### Test Proof Rules

- Tests must prove the behavior they claim to cover, not just that the page renders.
- If a test claims role, permission, or ownership behavior, it must assert an observable difference between the relevant states.
- When replacing manual API mocks with MSW, keep the slice scoped to the intended feature area unless the user explicitly approves broader cleanup.
- Add DB-backed integration only when the real backend boundary materially increases confidence over a unit or MSW-backed UI test.

---

## 6. Smoke and Browser E2E Rules

### API Smoke

- Lives under `tests/api/functional/*.smoke.ts` and related health smoke files.
- Treat smoke tests as black-box environment validation against deployed services.
- In CI/CD, smoke runs after the deployment pipeline completes migration and seed successfully; treat that sequencing as part of the contract when debugging failures or updating test strategy.
- Application seed flows are never a place for test fixtures. No agent, including test-building or QA-focused agents, may add QA data, smoke-test data, E2E data, manual-test data, fake contests, fake contestant pools, fake odds, fake rankings, or fake results to `prisma/seed.ts` or any other application seed path. Keep seed data limited to production-required bootstrap records and default configuration; put non-production contest/odds/results fixture catalogs behind dedicated test infrastructure such as `mock-contest-feed-provider`.
- Use shared route constants from `@poolmaster/shared/api-routes`.
- Keep smoke flows aligned with real critical-path behavior.
- When endpoint contracts change, smoke tests must change with them.
- Smoke tests must not rely on seed data, ambient discovery data, fake UUIDs, or preexisting contest/pool state.
- Smoke tests should create the minimum live data they need through real deployed routes whenever the product supports it.
- Smoke assertions should be strong and intentional; do not accept broad fallback status ranges like `200 | 400 | 500` on critical-path checks.
- Keep API smoke coverage small and MVP-focused: health, auth, league/invite flow, one supported contest creation flow, one supported selection flow, and one standings/results read flow.

### Browser Smoke / E2E

- Lives under `clients/web/e2e/`.
- Uses Playwright against a running local app or deployed environment.
- In CI/CD, browser E2E runs only after migrate -> seed -> smoke succeed; keep the suite scoped to a few durable MVP flows so it remains a true post-deploy confidence layer rather than a broad regression matrix.
- Focus on high-value user journeys and runtime error detection.
- Remove or update browser tests when they reference retired UI paths or dead buttons.
- Browser smoke/E2E should prove the narrowed MVP path, not just public-page rendering.
- Avoid tests that inject fake app state or bypass core product setup unless that is the explicit subject under test.
- Prefer one or two durable end-to-end flows over a wide set of shallow page-load checks.
- Browser automation must prefer stable machine selectors (`data-testid`, stable `id`) over human-readable copy.
- Do not anchor deploy-gate browser tests to marketing headings, button labels, or translated strings unless the explicit purpose of the test is to validate that copy.
- If a browser flow needs to click or read an element repeatedly, add a stable selector in the product code rather than teaching the test to depend on visible text.
- Until the codebase is more stable, do not expand smoke or deployed browser E2E breadth aggressively. Prefer increasing defect-finding power in unit, database-backed integration, contract-aligned integration, and app-level Vitest suites first.

### React Testing Library Selector Rule

- Do not use visible string literals as the default selector strategy for automation-critical UI.
- Prefer `getByTestId`, stable field `id`s, and other machine-oriented selectors for controls that represent product workflow steps.
- Use visible text assertions only when the test is intentionally validating copy, localization, or accessibility wording.

---

## 7. What Must Be Tested

### Backend

- Authentication and authorization behavior
- Route validation behavior
- DTO contract compliance
- Persistence for changed model fields
- Tenant isolation
- Critical business flows

### Frontend

- Loading, error, and empty states
- Form validation and submission behavior
- Navigation to critical product pages
- Mutations that change server state
- Critical authenticated flows

---

## 8. What Not To Do

- Do not keep around tests that verify bad architecture.
- Do not preserve tests for no-op UI.
- Do not update mocks without checking whether the real contract changed.
- Do not hand-wave broken contract tests as “just generated client issues.”
- Do not skip OpenAPI validation after changing route schemas.

---

## 9. Documentation Drift Rules

If test strategy changes materially, update this file in the same work.

Examples:

- moving from manual client mocks to MSW
- changing smoke test locations or commands
- changing required local quality gates
- changing contract-validation expectations
