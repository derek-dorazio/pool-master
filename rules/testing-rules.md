# PoolMaster — Testing Rules

All services and clients must follow these testing standards. This document defines the testing strategy, contract validation rules, functional test expectations, and when old tests should be removed rather than preserved.

> **Architecture dependency:** This document assumes the stack in [architecture-rules.md](architecture-rules.md): Fastify + TypeScript backend, the single React PoolMaster web client, native iOS/Android clients, DTO-driven OpenAPI, and shared generated `hey-api` clients.

---

## 1. Testing Tools

### Backend

| Tool | Purpose |
|---|---|
| Jest | unit and integration test runner |
| Fastify `inject` | request/response integration testing |
| Prisma test DB / local infra | persistence-backed integration tests |
| `nock` / service mocks | external dependency isolation where needed |

### Frontend — PoolMaster Web

| Tool | Purpose |
|---|---|
| Vitest | unit and integration-style test runner |
| React Testing Library | user-focused component and page tests |
| MSW | request-level API mocking |
| Playwright | future post-deploy browser E2E tests for the rebuilt PoolMaster web app |

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
| Functional | full service-stack verification through the generated SDK | yes | active backend acceptance gate |

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
4. `npm run test:functional`
5. `cd clients/poolmaster && npx vitest run`
6. `npm run test:coverage:backend`

Contract-specific commands:

7. `npm run api:refresh` when API schemas change
8. `npm run api:validate` when OpenAPI output changes

Notes:

- DB-backed integration tests may need to run outside the Codex sandbox/container when they depend on a developer-local Postgres instance such as `localhost:5432`.
- In those cases, ask for permission and run the exact integration command outside the sandbox rather than treating the failure as an application defect.
- If a DB-backed integration command fails with a local connection error in the sandbox but local database commands such as `prisma migrate deploy` or `psql` succeed, retry the exact test command outside the sandbox before assuming the failure is in application code.

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

A backend slice that adds or changes an API endpoint is **not complete** until a contract test case exists for that endpoint.

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

## 6. Functional and Browser E2E Rules

Backend functional tests and any future browser E2E tests must be **use-case driven**. Each test file must walk a documented user journey from the plan use-case companions rather than poking endpoints or asserting page loads.

### Use-Case Traceability

Smoke and E2E tests should be use-case driven and traceable to documented product behavior:

- Reference the plan companion and use-case ID in a comment at the top of the test file or in the `describe` block name (e.g., `// Proves: Plan 38 UC-003 — Member creates contest entry`).
- If a test covers behavior not yet documented and the behavior is product-significant, document the use case before expanding that suite further.
- When a use-case companion changes, update the corresponding functional or E2E tests in the same work.

### Seed Data Rules (Applies to Functional and E2E)

- Application seed flows are never a place for test fixtures. No agent may add QA data, functional-test data, E2E data, fake contests, fake odds, or fake results to `prisma/seed.ts` or any other application seed path.
- Keep seed data limited to production-required bootstrap records and default configuration.
- Non-production fixture catalogs belong behind dedicated test infrastructure such as `mock-contest-feed-provider`.

### Backend Functional API Tests

- Lives under `tests/functional/*.functional.ts`.
- Treat functional tests as full service-stack validation through the generated SDK and real backend behavior.
- Functional tests are part of the required local and CI backend gate.

**Data strategy:**
- Functional tests must create all the data they need through real routes or approved test builders.
- Do not rely on seed data, ambient discovery data, fake UUIDs, or preexisting state.
- Each functional test file should use isolated setup and must not depend on data from other test files.

**Assertion rules:**
- Assertions must be strong and intentional. Do not accept broad fallback status ranges like `200 | 400 | 500`.
- Assert on response body shape using DTO schemas where practical (`schema.safeParse(body)`).
- Use shared route constants from `@poolmaster/shared/api-routes`.
- Use shared domain enums from `@poolmaster/shared/domain` for status values, sport types, etc.
- When endpoint contracts change, functional tests must change with them.

Functional suites should prioritize durable critical-path journeys covering:

- auth
- league membership and invitation
- commissioner contest setup
- member entry creation
- selection/draft flow
- scoring and standings read paths
- history reads
- consent and account essentials

The exact set of required flows may evolve with the active product scope and should follow the current plans.

### Browser E2E Tests (Playwright)

- Browser E2E is currently reset and should not block the active delivery pipeline until the rebuilt PoolMaster browser suite is reintroduced.
- When browser E2E returns, it should target only the PoolMaster web app.

**Use-case-driven E2E:**

E2E tests must prove complete user journeys, not page loads. Each test walks the UI flow that a real user would follow for a documented use case.

- **Do not** write tests that only navigate to a page and assert a heading is visible.
- **Do** write tests that perform the full action: fill forms, click buttons, verify state changes, navigate to result pages.
- **Do** assert observable outcomes: "entry appears in list," "standings show updated score," "invite link is copyable."

**Data strategy:**
- E2E tests must create their own data through real UI flows whenever possible (register → create league → invite → etc.).
- Do not hardcode seed data IDs (e.g., `00000000-0000-0000-0000-000000000001`). If a test needs pre-existing data, create it through the UI or API in a `beforeAll` hook.
**Selector rules:**
- Prefer stable machine selectors (`data-testid`, stable `id`) over human-readable copy.
- Do not anchor deploy-gate tests to marketing headings, button labels, or translated strings unless the explicit purpose is to validate that copy.
- If a browser flow needs to click or read an element repeatedly, add a stable `data-testid` selector in the product code.
- Interactive controls: `data-testid`
- Form inputs: semantic `id`
- Page landmarks: `data-testid` with domain-oriented kebab-case naming (e.g., `league-create-submit`, `contest-entry-list`)

**Error detection:**
- Every E2E test must assert no uncaught exceptions, no console errors (excluding known benign patterns), and no error boundary fallback UI.
- Use the shared fixtures pattern (`fixtures.ts`) that captures `console.error`, `pageerror`, and 5xx responses.

### React Testing Library Selector Rule

- Do not use visible string literals as the default selector strategy for automation-critical UI.
- Prefer `getByTestId`, stable field `id`s, and other machine-oriented selectors for controls that represent product workflow steps.
- Use visible text assertions only when the test is intentionally validating copy, localization, or accessibility wording.

---

## 7. Test Data Builders

Integration and functional tests must create complex object graphs (league → membership → squad → contest → entry → roster picks). To avoid duplicating setup logic across every test file, use shared builder/factory functions.

### Builder Pattern

- Shared test builders live in `tests/helpers/builders.ts` (or a `tests/helpers/builders/` directory for larger sets).
- Each builder creates a valid domain object through real service calls or Prisma, not by inserting raw SQL.
- Builders return the created object (with ID) so tests can reference it.
- Builders accept optional overrides for fields the test cares about; use sensible defaults for everything else.

**Example:**

```typescript
// tests/helpers/builders.ts
export async function buildLeagueWithOwner(
  app: FastifyInstance,
  overrides?: { leagueName?: string }
): Promise<{ user: AuthUser; league: League; token: string }> {
  const { user, token } = await buildAuthenticatedUser(app);
  const league = await createLeague(app, token, {
    name: overrides?.leagueName ?? `Test League ${Date.now()}`,
    visibility: 'PRIVATE',
  });
  return { user, league, token };
}

export async function buildContestWithEntries(
  app: FastifyInstance,
  opts: { entryCount: number; sportEventId: string }
): Promise<{ contest: Contest; entries: ContestEntry[] }> { ... }
```

### Rules

- When integration or functional tests repeatedly create the same complex object graphs, prefer shared builders/helpers over copy-pasted setup.
- Builders must create data through the application layer (Fastify inject or service calls), not raw Prisma inserts, unless testing the persistence layer itself.
- Builders must not leave orphaned data. If a test needs cleanup, the builder should return enough context for the test to clean up in `afterAll`.
- Builders must use unique identifiers (e.g., `Date.now()` suffix on emails, names) to avoid collisions when tests run against a shared database.

---

## 8. Domain Event Testing

The in-process event bus is a critical architectural seam. Services emit domain events and subscribers react to them. This behavior must be tested.

### What Must Be Tested

- **Event emission:** When a service performs a state change, verify the correct event is emitted with the expected payload. Use a test spy or listener on the event bus.
- **Subscriber behavior:** When an event is received, verify the subscriber performs the expected side effect (e.g., contest status update, scoring recalculation trigger, notification creation).
- **Event contract:** Event payloads must match the typed event interfaces in `packages/shared/events/`. Add a contract-style assertion when the payload shape changes.

### How To Test

**Unit tests** for event emission:

```typescript
it('emits ContestStatusChangedEvent when contest transitions to LOCKED', async () => {
  const events: DomainEvent[] = [];
  eventBus.subscribe('ContestStatusChangedEvent', (e) => events.push(e));

  await contestService.lockContest(contestId);

  expect(events).toHaveLength(1);
  expect(events[0].payload).toMatchObject({ contestId, newStatus: 'LOCKED' });
});
```

**Integration tests** for subscriber side effects:

```typescript
it('updates contest status when SportEventStatusChanged is received', async () => {
  // Setup: contest linked to sport event
  eventBus.emit('SportEventStatusChangedEvent', { sportEventId, newStatus: 'COMPLETED' });

  // Verify: contest transitioned
  const contest = await contestRepo.findById(contestId);
  expect(contest.status).toBe('COMPLETED');
});
```

### Rules

- When a slice adds or materially changes domain-event behavior, add tests that cover the relevant event emission and subscriber side effects.
- Do not test event bus internals (delivery ordering, retry). Test the observable behavior: "when X happens, Y should result."

---

## 9. Integration Test Depth Requirement

Integration test files must not be single-case stubs. Each integration test file for a domain should include at minimum:

- **Happy path:** The primary use case succeeds with valid inputs.
- **Validation/negative path:** The endpoint rejects invalid input with the correct status code and error shape.
- **Permission/authorization path:** The endpoint returns 401 or 403 for unauthorized callers (where applicable).
- **Not-found path:** The endpoint returns 404 for non-existent resources (where applicable).

A single `it()` block per integration file is a sign the test is incomplete. Aim for 3–5 test cases per domain integration file covering the paths above.

---

## 9A. Integration Test Isolation and Cleanup

Integration tests share a single Postgres database and run serially (`maxWorkers: 1`). This works only if each test cleans up after itself.

### Rules

- Prefer shared cleanup helpers or other reliable isolation patterns appropriate to the test harness.
- Tests must not depend on data created by other test files. Each file is self-contained.
- Tests must not depend on execution order. If test B fails when test A is skipped, test B has a hidden dependency.
- Use unique identifiers (timestamps, UUIDs) for all created records to avoid collisions.
- Use explicit cleanup, unique identifiers, or transaction-based isolation as appropriate for the slice.

### Cleanup Pattern

```typescript
afterAll(async () => {
  const prisma = getPrisma();
  // Delete in reverse dependency order
  await prisma.rosterPick.deleteMany({ where: { entryId: { in: createdEntryIds } } });
  await prisma.contestEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  await prisma.contest.deleteMany({ where: { id: { in: createdContestIds } } });
  await prisma.leagueMembership.deleteMany({ where: { leagueId: { in: createdLeagueIds } } });
  await prisma.league.deleteMany({ where: { id: { in: createdLeagueIds } } });
});
```

Do not rely on `prisma migrate reset` between test runs. Tests must be idempotent against a persistent database.

---

## 10. What Must Be Tested

### Backend

- Authentication and authorization behavior
- Route validation behavior
- DTO contract compliance (via contract test suites)
- Error response shape compliance (consistent error envelope)
- Persistence for changed model fields
- League isolation (formerly tenant isolation)
- Domain event emission and subscriber behavior
- Critical business flows as documented in use-case companions

### Frontend

- Loading, error, and empty states
- Form validation and submission behavior
- Navigation to critical product pages
- Mutations that change server state
- Critical authenticated flows
- Error handling for the important backend error states exposed by the flows under test, especially authentication, authorization, validation, and not-found cases

### Smoke (API)

- Critical-path deployed checks aligned with the active product scope
- Error paths for authentication (expired token, missing token)
- Error paths for authorization (wrong role, wrong league)

### E2E (Playwright)

- High-value end-to-end user journeys aligned with the active product scope
- Error boundary absence on all tested pages
- Console error absence on all tested pages

---

## 11. What Not To Do

- Do not keep around tests that verify bad architecture.
- Do not preserve tests for no-op UI.
- Do not update mocks without checking whether the real contract changed.
- Do not hand-wave broken contract tests as “just generated client issues.”
- Do not skip OpenAPI validation after changing route schemas.

---

## 12. Documentation Drift Rules

If test strategy changes materially, update this file in the same work.

Examples:

- moving from manual client mocks to MSW
- changing smoke test locations or commands
- changing required local quality gates
- changing contract-validation expectations
