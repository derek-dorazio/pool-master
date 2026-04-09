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
6. `npm run test:coverage:backend`

Contract-specific commands:

7. `npm run api:refresh` when API schemas change
8. `npm run api:validate` when OpenAPI output changes

Notes:

- DB-backed integration tests may need to run outside the Codex sandbox/container when they depend on a developer-local Postgres instance such as `localhost:5432`.
- In those cases, ask for permission and run the exact integration command outside the sandbox rather than treating the failure as an application defect.
- If a DB-backed integration command fails with a local connection error in the sandbox but local database commands such as `prisma migrate deploy` or `psql` succeed, retry the exact test command outside the sandbox before assuming the failure is in application code.

Backend-first refactor branch exception:

- On the dedicated branch `codex-backend-refactor-lane`, use a backend-first
  validation set while the backend contract is intentionally unstable.
- Required on that branch:
  - backend/shared typecheck
  - backend/shared lint
  - backend unit tests
  - DB integration tests
  - merged backend coverage from unit + integration suites
  - `npm run api:refresh` and `npm run api:validate` when API schemas change
- Not required on that branch:
  - web Vitest
  - admin Vitest
  - frontend coverage gates
  - smoke tests
  - browser E2E
- This exception does not apply to `main`.

Backend-first refactor testing rules on `codex-backend-refactor-lane`:

- Treat the active use-case documents as required test inputs, not just design notes.
- New backend slices should prefer test-driven development when it helps clarify the behavior:
  - write the use-case-oriented unit or integration test first
  - implement until the test turns green
- Coverage is not only a percentage target. New backend code on this branch should aim for:
  - 80% or greater coverage on the newly added or materially rewritten backend code
  - plus explicit test cases for the identified use cases that code is intended to support
- Backend coverage on this branch should be measured from the merged backend report:
  - unit coverage output
  - DB integration coverage output
  - merged into one backend coverage summary via `npm run test:coverage:backend`
- For every new or materially redesigned domain object, add DB-backed integration coverage for at least:
  - create
  - update
  - delete or inactivate, as appropriate
  - `findById`
- For service slices driven by commissioner/member workflows, add tests that prove the backend supports the use cases documented in the corresponding plan companion.
- Do not spend effort fixing web/admin tests on this branch unless the user explicitly asks for frontend work.
- Frontend failures caused by intentional backend-contract redesign should not drive backend design compromises on this branch.
- Do not add fake seed data or fixture catalogs to application seed paths in order to satisfy tests. Tests must create and clean up their own data or use dedicated mock-provider infrastructure.
- Never add mock or fake behavior to application code in order to satisfy a test.
- Never replace real backend behavior with a fake response, fake fallback, or hardcoded success path just to turn a test green.
- If a test fails, determine whether it exposed a real application defect:
  - if yes, fix the production code with a real implementation
  - if no, correct the test
- Do not “fix” a legitimate application defect by weakening the test or mocking around the defect.
- Before committing a backend slice on this branch, make sure the required unit tests and DB integration tests for that slice pass and the slice meets the branch coverage expectation.
- When DTO/Zod schemas produce invalid Fastify or OpenAPI validation output, it is acceptable to keep the DTO schema for typing/parsing and use explicit JSON route schemas in the route module instead of forcing the route to use `zodToJsonSchema`.

---

## 4. Contract Testing Rules

PoolMaster treats API contracts as first-class test surfaces. Contract test existence is an **execution gate**, not a follow-up task.

- Contract tests must validate live responses against DTO Zod schemas using `.safeParse()`.
- New or changed endpoints must update:
  - `tests/integration/core-api/api-contracts-web.integration.ts`
  - `tests/integration/core-api/api-contracts-admin.integration.ts`
  - or a clearly equivalent contract suite
- If response shape changes, update the contract test in the same change.
- Do not rely on TypeScript alone to prove runtime payload shape correctness.

### Contract Test Gate

A backend slice that adds or changes an API endpoint is **not complete** until a contract test case exists for that endpoint. This applies equally on `codex-backend-refactor-lane` and `main`.

If the contract test suite files do not yet exist, the first slice that adds or changes an endpoint must create them. Subsequent slices add cases to the existing suites.

**Minimum contract test per endpoint:**

```typescript
it('GET /api/v1/<resource> matches <Resource>ResponseSchema', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/<resource>', headers: authHeaders });
  expect(res.statusCode).toBe(200);
  const parsed = <Resource>ResponseSchema.safeParse(JSON.parse(res.payload));
  expect(parsed.success).toBe(true);
});
```

Do not defer contract tests to a "testing cleanup slice." They are part of the slice that changes the contract.

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

### React Testing Library Selector Rule

- Do not use visible string literals as the default selector strategy for automation-critical UI.
- Prefer `getByTestId`, stable field `id`s, and other machine-oriented selectors for controls that represent product workflow steps.
- Use visible text assertions only when the test is intentionally validating copy, localization, or accessibility wording.

---

## 7. Integration Test Depth Requirement

Integration test files must not be single-case stubs. Each integration test file for a domain should include at minimum:

- **Happy path:** The primary use case succeeds with valid inputs.
- **Validation/negative path:** The endpoint rejects invalid input with the correct status code and error shape.
- **Permission/authorization path:** The endpoint returns 401 or 403 for unauthorized callers (where applicable).
- **Not-found path:** The endpoint returns 404 for non-existent resources (where applicable).

A single `it()` block per integration file is a sign the test is incomplete. Aim for 3–5 test cases per domain integration file covering the paths above.

---

## 8. What Must Be Tested

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

## 9. What Not To Do

- Do not keep around tests that verify bad architecture.
- Do not preserve tests for no-op UI.
- Do not update mocks without checking whether the real contract changed.
- Do not hand-wave broken contract tests as “just generated client issues.”
- Do not skip OpenAPI validation after changing route schemas.

---

## 10. Documentation Drift Rules

If test strategy changes materially, update this file in the same work.

Examples:

- moving from manual client mocks to MSW
- changing smoke test locations or commands
- changing required local quality gates
- changing contract-validation expectations
