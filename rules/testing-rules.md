# PoolMaster — Testing Rules

All services and clients must follow these testing standards. This document defines the testing strategy, contract verification rules, functional test expectations, and when old tests should be removed rather than preserved.

> **Architecture dependency:** This document assumes the stack in [architecture-rules.md](architecture-rules.md): Fastify + TypeScript backend, the single React PoolMaster web client, native iOS/Android clients, DTO-driven OpenAPI, and shared generated `hey-api` clients.

---

## 1. Testing Tools

### Backend

| Tool | Purpose |
|---|---|
| Jest | unit and integration test runner |
| Fastify `inject` | request/response integration testing |
| Prisma test DB / local infra | persistence-backed data integration tests |
| `nock` / service mocks | external dependency isolation where needed |

### Frontend — PoolMaster Web

| Tool | Purpose |
|---|---|
| Vitest | unit and integration-style test runner |
| React Testing Library | user-focused component and page tests |
| MSW | request-level API mocking |
| Playwright | post-deploy browser E2E tests for the rebuilt PoolMaster web app |

### Mobile

| Platform | Tooling |
|---|---|
| iOS | XCTest / XCUITest |
| Android | JUnit / Compose UI tests / instrumentation where needed |

### Testing Persona Boundary

- `Tess` defines expected scenario/layer coverage in a feature test matrix when
  that planning artifact exists.
- `Quinn` executes the relevant lanes, triages failures, and reports release
  confidence.
- `Riley` reviews code quality and regression risk, but does not replace Tess
  as the coverage-matrix owner.

### Core Testing Standard

Coverage percentages are only a backstop. The primary standard is behavioral
proof:

- every documented positive use case must be represented by at least one
  automated test at the most appropriate layer
- every documented negative/error/permission use case must be represented by at
  least one automated test at the most appropriate layer
- if a released behavior does not have a truthful automated proof, it is not
  considered complete just because line coverage thresholds pass

The 80% changed-file expectation exists to pressure slices toward writing tests,
but it does not replace use-case coverage. A slice with acceptable percentage
coverage but missing core positive/negative use-case proof is still incomplete.

### Logging and Branch-Proof Rule

When a slice is instrumenting logging or auditing branch behavior, the testing
goal is still behavioral proof, not log-string proof.

- Do not assert log message strings or snapshot raw log output as the primary
  test evidence.
- Tests must assert the natural outcome of the branch under test:
  - typed exceptions
  - normalized error envelopes/codes
  - returned values
  - state transitions
  - persistence/query results
- If branch logic is not testable without asserting logs, refactor the code so
  the branch behavior becomes testable directly.
- Logging/backfill slices are incomplete until the newly instrumented positive
  and negative branches are also covered by truthful automated tests at the
  appropriate lower layer.

---

## 1A. Test Self-Documentation

Every test must announce *what it is testing* in machine-readable, reviewable form. A test that doesn't explain its purpose is treated as missing for the purposes of the slice-completion checklist and Riley review.

### Required for new tests

For **every new test** added in a slice, the describe block, test name, or a leading comment must reference one of:

- **A documented use-case ID** (e.g., `UC-LM-003 — Owner cannot delete a league with active members`) drawn from the relevant `requirements/product-requirements/features/<feature>/use-cases.md`.
- **A documented business rule ID** when no use case applies cleanly (e.g., `BR-AUTH-12 — Sessions expire after 24h`).
- **A defect ID** for regression tests (e.g., `pool-master-142 — Status field returned as null after archive`).

The reference must be specific. `// covers leagues feature` is not enough; `// UC-LM-003: owner-archive blocks deletion` is.

### Required for existing tests touched by a slice

If the slice modifies an existing test's behavior (assertion, setup, expected value), update the traceability comment if the use-case or business rule it covers has shifted. Stale references are worse than missing ones.

### Format

Three forms are acceptable; pick the one that fits the test layer:

- **Describe-block prefix** — preferred for grouping related cases:
  ```typescript
  describe('UC-LM-003: Owner archive blocks deletion', () => { ... })
  ```
- **Test-name prefix** — preferred for one-off cases:
  ```typescript
  it('UC-LM-003: rejects DELETE when status=archived', async () => { ... })
  ```
- **Leading comment** — acceptable when the test name is already long:
  ```typescript
  // UC-LM-003 — owner-archive blocks deletion
  it('returns 409 with code LEAGUE_ARCHIVED', ...)
  ```

### When use-case-style traceability does not apply

For genuinely infrastructure-only tests (e.g., a utility helper, a serialization edge case with no product-visible flow), reference the rule or pattern it enforces — not just "tests serializeDate." Example: `// rule: ISO 8601 over the wire (service-rules §4)`. If neither a use case, business rule, defect, nor rule reference applies, the test probably should not exist.

### Why

Riley and Quinn rely on these references to audit coverage; future agents rely on them to know which tests to update when a use case changes; reviewers rely on them to confirm the slice tested what it claimed.

---

## 1B. Forbidden Application-Code Patterns

Tests exist to exercise real production code paths. Production code must never be modified to accommodate tests.

### Forbidden in application code

- **Hardcoded sample responses** — `if (id === 'test-123') return { … }`.
- **Synthetic fallbacks** — returning a fabricated default object when the real lookup fails, *for the purpose of making a test pass*.
- **"Test mode" branches** — `if (process.env.NODE_ENV === 'test') { … behave differently … }` to produce predictable test outputs.
- **Mock data baked into production paths** — seed-style records, stub user accounts, or placeholder entities that production-flow code returns.
- **Suppressed errors that production should surface** — swallowing a real error so a test that expected success doesn't fail.
- **Branches that exist solely to fail in a controlled way under test** — code structured to *fail* unnaturally so a test can assert that failure.

If a test cannot be made to pass against real production code, the conclusion is one of:

1. The production code has a real defect — fix it.
2. The test is asserting something the contract does not actually require — fix the test.
3. The behavior is not exercisable at this layer — move the test to a layer where it is.

The conclusion is **never** "modify the production code to make the test pass."

### Where mocks and fakes belong

Mocks, fakes, builders, fixtures, MSW handlers, and `nock` interceptors live in **test code** (`tests/**`, `*.test.ts`, `*.spec.ts`, `clients/**/test/**`, MSW handler modules). They never live in `packages/`, `clients/poolmaster/src/`, or any other production source path.

### Repository surface

If you find yourself adding any of the patterns above to make a slice pass, **stop**. Surface the conflict to the user before proceeding. This is a hard rule — Riley flags any instance as a CRITICAL finding and blocks merge.

See also `§3 Defect Verification Protocol` (formerly *Defect Regression Proof Rule*) for the failing-test-before-fix discipline that prevents the most common path into these patterns.

---

## 1C. Test-Disable Discipline

A skipped, todo'd, or expected-to-fail test is a hole in the suite. The auto-merge gate is meaningless if "all green" is achieved by silently turning off the tests that aren't passing.

### Forbidden without an active Beads story

The following markers are not allowed in committed code unless they are paired with a referenced Beads story tracking the un-skip:

- `it.skip(...)`, `xit(...)`, `test.skip(...)`, `xtest(...)`
- `describe.skip(...)`, `xdescribe(...)`
- `it.todo(...)`, `test.todo(...)`
- `it.fails(...)`, `test.fails(...)` (Vitest expected-failure marker)
- `it.failing(...)` (Jest equivalent)
- Test files renamed to `.skip.test.ts` or moved into a `skipped/` directory to evade discovery
- `pending(...)` calls inside a test body
- Hand-rolled early-`return` from a test body that bypasses assertions

### Required when a skip is genuinely necessary

A skip is genuinely necessary only when:

- The test is asserting behavior that is intentionally deferred to a future slice and removing the test loses signal that should be re-acquired later, or
- The test is blocked by a fixture / environment / external dependency that cannot be resolved in the current slice.

In those cases:

1. Open a Beads story for the un-skip (label `cleanup` and `layer/test-*`).
2. Add a leading comment immediately above the skip with the story ID and one-line reason:
   ```typescript
   // SKIP: pool-master-312 — flaky against ephemeral DB; un-skip after migration to test-containers
   it.skip('UC-LM-003: rejects DELETE when status=archived', ...)
   ```
3. Reference the same story ID in the slice's Beads closing note.

### Forbidden in all cases

- A skip without a referenced Beads story.
- A skip whose stated reason is "test is wrong" or "behavior changed" — those are deletes, not skips. Delete the test instead.
- A skip whose stated reason is "intermittently fails" without a Beads story tracking the flake fix.
- Re-skipping a test that was un-skipped in a prior slice without surfacing the regression to the user.

### Repository scan and CI

A grep for the markers above (`grep -rE '\.(skip|todo|fails|failing)\(|^x(it|test|describe)\(' tests/ packages/*/src/ clients/*/src/`) should return zero matches that lack an adjacent `SKIP: pool-master-NNN` comment. This grep belongs in the `lint` or a dedicated `test:no-undocumented-skips` script.

Riley scans for this on every review:

- Any skipped/todo/expected-fail test introduced by the slice without a `SKIP: pool-master-NNN` comment is a **TEST / HIGH** finding and blocks merge.
- Any skipped test introduced by the slice with a comment but no actual Beads story is a **TEST / HIGH** finding and blocks merge.

---

## 2. Test Layers

### Backend

| Suite | Scope | Real DB | Notes |
|---|---|---|---|
| Unit | function/service behavior in isolation | no | mock dependencies intentionally; prove business logic here |
| Data Integration | persistence-layer behavior through real DB queries, repositories, and lower-level route/service reads/writes | yes | persistence-layer unit proof: CRUD, query correctness, filtering, sorting, joins, aggregations, fallback queries, and integrity constraints |
| Contract Verification | live response/request shape vs DTO schema on representative endpoints | yes | thin API-boundary schema-alignment gate; implemented as integration-style suites |
| Functional API (FAPI) | full service-stack verification through the generated SDK and real HTTP | yes | emulates real web/mobile SDK consumers and proves API-exposed flows, not exhaustive branch/query permutations |

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
4. `npm run test:service:functional-api`
5. `npm run test:poolmaster:unit`
6. `npm run test:coverage:service:merged`

Contract-verification-specific commands:

7. `npm run api:refresh` when API schemas change
8. `npm run api:validate` when OpenAPI output changes

Notes:

- The precursor to the CI-baseline rule is local truthfulness: if the relevant
  required local suites for a slice are failing, the slice is not finished.
- Focused or nearby test runs are useful for iteration speed, but they are
  additive only. They never replace the required local gate set before commit
  or push.
- A slice that passes only targeted tests but skips a required broader gate is
  still unvalidated. If CI later finds a stale unit/integration/functional
  failure that the required local gate would have caught, that is a workflow
  failure, not a CI-only surprise.
- DB-backed integration tests may need to run outside the Codex sandbox/container when they depend on a developer-local Postgres instance such as `localhost:5432`.
- In those cases, ask for permission and run the exact integration command outside the sandbox rather than treating the failure as an application defect.
- If a DB-backed integration command fails with a local connection error in the sandbox but local database commands such as `prisma migrate deploy` or `psql` succeed, retry the exact test command outside the sandbox before assuming the failure is in application code.
- Treat `poolmaster_test` as an always-disposable local test database. It is
  acceptable to reset or recreate it before an integration, FAPI, or merged
  coverage run.
- If a DB-backed run was interrupted or residue is suspected, prefer the
  supported reset-first path:
  - confirm local Postgres is running
  - rerun the exact command once Postgres is available
  - if `poolmaster_test` still looks dirty, use `npm run db:test:reset` or the
    matching `:fresh` script (`test:service:integration:fresh`,
    `test:service:functional-api:fresh`, `test:coverage:service:fresh`)
- Backend work must not be pushed with required test gates intentionally
  skipped. CI is confirmation, not the first place we discover missing local
  validation.
- "I ran the tests closest to the code I changed" is not sufficient when the
  repo rules require broader gates. Shared-model, shared-contract, or shared
  service changes must still clear the full required local suites because stale
  assertions often live outside the immediately touched files.
- Failing automated tests indicate either:
  - a real defect that must be fixed immediately, or
  - a test that is no longer truthful and must be corrected or removed in the
    same slice
- Do not knowingly deploy broken or half-implemented code behind a green-ish
  test story. If the released behavior is still broken, the fixing slice is not
  done and deployment should stop.
- Webapp work that changes shared domain types, DTOs, generated contract
  outputs, backend mappers, or backend response shaping is not frontend-only
  testing scope. Treat it as backend-impacting work and rerun the full backend
  gate set before push.
- When a slice changes the backend model, rerun and repair every impacted suite
  in the local gate set as part of that slice. Stale mocks, factories,
  builders, or setup helpers are not separate cleanup work; they are part of
  the model-change fix.

### Defect Verification Protocol

(Formerly *Defect Regression Proof Rule*.)

For any slice whose purpose is to fix a defect (a bug, a regression, a wrong-behavior report), the slice must include both:

1. **A failing test that reproduces the defect** *on the broken code*. The test asserts the expected correct behavior and demonstrates that the unfixed code violates it.
2. **The fix** that makes the test pass without weakening any unrelated test.

### Required ordering and visibility

The slice must make both halves visible in its history:

- **Preferred:** two commits — `commit 1` adds the failing test (and may temporarily mark it `it.skip` only if absolutely required to keep `main` green; this is rare). `commit 2` lands the fix and unmarks the test. Both reference the same defect ID (e.g., `pool-master-NNN`).
- **Acceptable:** one commit when adding the failing test alone would block other work. The PR description must then explicitly state that the test was written first and observed to fail before the fix landed, and the Beads story closing note must record the failing-then-passing observation.

The intent is reviewable proof that the test actually catches the defect — not retrofit confidence after the fact.

### Required behavior

- Start by writing or updating at least one automated regression test whose assertion would fail if the old buggy behavior were still present.
- Prefer a red → green loop locally: run the new regression test before the fix, confirm it fails for the right reason, then implement the fix and rerun it to green.
- If the defect is discovered after code is already partially patched, tighten the regression test so it still clearly proves the old behavior would fail and explain that in the slice notes or handoff.
- Do not introduce synthetic failures just to make a regression test go red. The regression test must exercise the real escaped scenario and assert the natural buggy outcome or signal, such as an unexpected extra fetch, stale UI, wrong state transition, or incorrect returned value.
- Do not settle for post-fix snapshotting or cache-shape assertions when the real regression risk is a user-visible failure mode such as a refetch loop, thrown error state, broken navigation, or stale screen state.
- After the focused regression test passes, run the full required local gate set for the slice. Focused tests prove the bug; broad gates prove the fix did not regress the rest of the repo.

### Test placement

The failing test goes in the layer that most naturally proves the defect:

- API-visible bug → functional API test
- Persistence/query bug → data integration test
- Pure logic bug → unit test
- UI bug → frontend integration / Playwright test

Adding the test only at a layer where it cannot actually catch the defect (e.g., a unit test for a bug that only reproduces with a real DB) does not satisfy this rule.

### Traceability

The failing/passing test must reference the defect ID per §1A — `pool-master-NNN — <one-line defect description>`.

### When this rule does not apply

- Slices that add genuinely new behavior (no prior code path to defect against) — the use-case coverage rules in §1 still apply; the defect protocol does not.
- Slices that refactor without behavior change and are covered by existing tests.
- Slices whose only purpose is documentation, dependency bumps, or test-infrastructure work.

---

## 4. Contract Verification Rules

PoolMaster treats API contracts as first-class test surfaces. Contract verification is an **execution gate**, not a follow-up task.

- Contract verification suites must validate live responses against DTO Zod schemas using `.safeParse()`.
- New or changed endpoints must update:
  - `tests/integration/core-api/contract-verification-web.integration.ts`
  - `tests/integration/core-api/contract-verification-root-admin.integration.ts`
  - or a clearly equivalent contract-verification suite
- If response shape changes, update the contract-verification case in the same change.
- Do not rely on TypeScript alone to prove runtime payload shape correctness.

### Contract Verification Gate

A backend slice that adds or changes an API endpoint is **not complete** until a contract-verification case exists for that endpoint.

If the contract-verification suite files do not yet exist, the first slice that adds or changes an endpoint must create them. Subsequent slices add cases to the existing suites.

**Minimum contract-verification case per endpoint:**

```typescript
it('GET /api/v1/<resource> matches <Resource>ResponseSchema', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/<resource>', headers: authHeaders });
  expect(res.statusCode).toBe(200);
  const parsed = <Resource>ResponseSchema.safeParse(JSON.parse(res.payload));
  expect(parsed.success).toBe(true);
});
```

Do not defer contract verification to a "testing cleanup slice." It is part of the slice that changes the contract.

### Shared DTO Reuse Rule

When a route reuses an existing shared DTO on a new API surface, contract
verification must include at least one representative happy-path assertion for
that surface, not only error-path checks.

Why:

- shared DTO reuse is a common place where fields get omitted or remapped
  incorrectly
- negative-path-only coverage will miss serialization and enum-mapping drift
  until broader CI coverage fails

Examples that require happy-path verification:

- root-admin or admin routes reusing account/auth user DTOs
- alternate list/detail surfaces reusing an existing entity DTO
- new role-scoped endpoints returning a previously defined response schema

### Contract Verification Heuristics

Use contract verification when the goal is to prove exported DTO/OpenAPI alignment, not to re-run whole user journeys.

- Keep these suites small and representative.
- Validate endpoints that are new, materially changed, or especially likely to drift.
- Prefer one focused schema assertion over a second broad behavioral workflow.
- Do not turn contract verification into a duplicate FAPI suite.
- Do not keep a contract-verification case once it only repeats behavior already better proved elsewhere and adds no schema-drift signal.

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
- lower-signal duplicates of stronger MSW/contract verification coverage

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

### Required Use-Case Coverage Mapping

For every active feature lane, Tess and Quinn must be able to point to where
the documented use cases are proven.

Minimum expectation before deployment:

- positive happy path coverage for each released use case
- negative/error or permission-path coverage for each released use case where a
  failure mode is product-significant
- at least one full-stack connected proof for each released user-facing
  workflow family

Acceptable proof layers vary by behavior:

- unit: business logic and validation branches
- data integration: persistence/query semantics
- contract verification: DTO/runtime shape proof
- functional API: truthful API-level user journey proof
- browser E2E: truthful connected browser workflow proof

Do not rely on only one layer when the released behavior spans multiple risks.
For example, a commissioner contest setup flow may need:

- contract verification for the routes
- functional API for the create/update journey
- browser E2E smoke for one truthful connected path once the environment is
  stable

### Use-Case Traceability

Smoke and E2E tests must follow §1A *Test Self-Documentation*. Reference the use-case ID, business-rule ID, or defect ID in the describe block, test name, or a leading comment (e.g., `// UC-CO-003 — Member creates contest entry`).

Additional E2E-specific guidance:
- If a test covers behavior not yet documented and the behavior is product-significant, document the use case before expanding that suite further.
- When a use-case companion changes, update the corresponding functional or E2E tests in the same work.
- As the PoolMaster web app grows, extend the existing reviewed Playwright
  journeys to cover each newly delivered page, route, or meaningful user-facing
  function when that behavior fits an established journey.
- If a new webapp slice does not fit cleanly into an existing reviewed browser
  journey, create a new focused journey tied to the relevant plan/use-case
  companion instead of leaving the new behavior uncovered.
- Browser E2E does not need exhaustive assertions for every new screen, but it
  should exercise a basic truthful proof that each newly delivered page or
  function can be reached and works in the intended user journey.
- If it is unclear whether a new webapp behavior belongs in an existing browser
  journey or needs a new one, stop and ask the user before finalizing the test
  plan.

### Long-Term Browser E2E Strategy

- Prefer a small number of long-lived browser journeys over many overlapping
  scripts.
- Start with one primary commissioner-centric script and extend it as new
  commissioner functionality is added.
- Add additional browser scripts only when a different user role or a clearly
  separate journey cannot be covered cleanly inside the primary script.
- When additional scripts are needed, split by role or truly distinct journey,
  not by arbitrary feature duplication.
- Do not create multiple commissioner scripts unless there is a concrete reason
  that one commissioner journey can no longer stay coherent.

### Browser E2E Purpose

The browser E2E suite exists to smoke test a real connected workflow through
the deployed stack so we can catch integration breakage that lower layers miss.

That means:

- each browser journey must prove a real user can complete the intended flow,
  not just load the first page
- browser E2E should flush out connection defects between frontend, API,
  persistence, auth, background work, and environment data/setup
- if a browser E2E workflow cannot run because required environment data does
  not exist, that is an environment/product-readiness defect to plan around,
  not a reason to pretend the flow is already proven

Browser E2E is **not** the primary mechanism for discovering ordinary coding
defects. The intended defect-detection order is:

1. local unit/integration/contract/functional suites before commit
2. CI validation before publish/artifact promotion
3. browser E2E smoke for deployment failures, broken stack wiring, and
   environment/configuration regressions

If browser E2E is repeatedly finding defects that should have been caught by
lower layers, stop expanding E2E and strengthen the lower-layer tests first.

### Browser E2E Cleanup Rules

- Browser E2E should not rely on application seed data, legacy QA state, or
  ambient existing records.
- Browser E2E should create the data it needs through truthful user-facing
  flows whenever practical.
- Prefer cleanup through real product lifecycle APIs and UI flows rather than
  privileged backdoors.
- It is acceptable to defer richer browser E2E expansion while the lower-layer
  test foundation is still not reliably proving the same workflows.
- Long-term target:
  - commissioner journeys clean up league-owned data through real commissioner
    lifecycle flows
  - user accounts clean up through real self-service account lifecycle flows
- If the real product lifecycle needed for cleanup does not yet exist, keep the
  deploy-gate browser lane minimal rather than keeping broader residue-creating
  journeys active.
- Do not expand the deploy-gate browser suite with new residue-creating flows
  unless the cleanup path for those flows is also designed and tracked.

### Seed Data Rules (Applies to Functional and E2E)

- Application seed flows are never a place for test fixtures. No agent may add QA data, functional-test data, E2E data, fake contests, fake odds, or fake results to `prisma/seed.ts` or any other application seed path.
- Keep seed data limited to production-required bootstrap records and default configuration.
- Non-production fixture catalogs belong behind dedicated test infrastructure such as `mock-contest-feed-provider`.

### Backend Functional API Tests

- Lives under `tests/functional/*.functional.ts`.
- Treat functional tests as full service-stack validation through the generated SDK and real backend behavior.
- Functional tests are part of the required local and CI backend gate.

**When a backend behavior belongs in FAPI:**
- the behavior should be proven from the perspective of a real SDK client
- real HTTP serialization or cookie/session handling matters
- the flow is a documented API use case or client journey
- the frontend or a mobile client would rely on the behavior as a product capability
- the test should verify positive flow, negative/error flow, permission behavior, or representative parameter handling at the API layer

**Do not use FAPI when:**
- the only value is proving a DTO shape on a representative endpoint
- the assertion is mainly about DB persistence internals rather than a client-visible workflow
- the goal is exhaustive logic-branch or query-permutation coverage that belongs in unit or data integration tests

**Data strategy:**
- Functional tests must create all the data they need through real routes or approved test builders.
- Do not rely on seed data, ambient discovery data, fake UUIDs, or preexisting state.
- Each functional test file should use isolated setup and must not depend on data from other test files.
- Functional cleanup helpers must delete child records before parent records; for contest flows, remove contest entries and contest descendants before squads and leagues.
- Functional builders and setup helpers must fail descriptively. When an SDK setup call fails, include the response status and error payload in the thrown error so review and debugging do not stop at a vague \"register failed\" message.

**Assertion rules:**
- Assertions must be strong and intentional. Do not accept broad fallback status ranges like `200 | 400 | 500`.
- Assert on response body shape using DTO schemas where practical (`schema.safeParse(body)`).
- Use shared route constants from `@poolmaster/shared/api-routes`.
- Use shared domain enums from `@poolmaster/shared/domain` for status values, sport types, etc.
- When endpoint contracts change, functional tests must change with them.
- Do not weaken a test to match known-wrong production behavior when the contract or domain rule says the implementation is wrong. Fix the service behavior first, then update the test to assert the corrected behavior.
- When a slice introduces or standardizes intentional error conditions, functional API coverage must include explicit negative-path cases for those errors and assert the expected application error codes, not just the HTTP status.
- Do not stop at a single generic failure case when the route exposes multiple meaningful denial reasons; cover the distinct error conditions that the frontend or other clients need to handle differently.

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

### Backend Data Integration Tests

Data integration tests live under `tests/integration/core-api/*.integration.ts`.

Treat data integration as the persistence-layer unit suite.

Use data integration when the test needs to prove something that should be validated at the persistence or lower-level runtime boundary:

- repository and persistence correctness
- CRUD behavior
- query correctness
- filtering, sorting, joins/includes, and aggregation behavior
- DB-backed fallback behavior
- lower-level state transitions that are not meaningful product journeys on their own
- persistence-edge constraints such as uniqueness, cascade/delete behavior, recalculation persistence, or read-model materialization
- route behavior that is still best exercised with `Fastify.inject()` and direct DB inspection

Do not keep a data integration test if:
- FAPI now proves the same workflow, error behavior, and client-visible outcome with equal or better confidence
- the test exists only because a weaker pre-SDK strategy once needed it

Prefer to keep data integration tests for:
- scoring persistence/recalculation
- repository-heavy ingestion persistence
- history fallback logic
- draft/roster persistence details that are more about stored state than client workflow
- query/read-model correctness where the main proof is “this returns the correct data from the real DB”
- representative permanent keep areas such as scoring results/recalculation, ingestion persistence, history read fallbacks, roster-pick persistence, sport-event participant repository queries, standings/dashboard read models, and lower-level contest-management configuration flows

### Data Integration Depth Requirement

Data integration files should prove a meaningful slice of persistence or lower-level runtime behavior, not stop at a single happy-path stub.

- Prefer `3-5` substantial cases per file when the surface naturally supports it.
- Cover the relevant mix of:
  - happy path
  - negative validation path
  - permission/authorization path where applicable
  - not-found or missing-state path where applicable
- It is acceptable for a highly focused persistence file to have fewer cases when the subject is intentionally narrow, but that should be the exception rather than the default.
- Do not create placeholder data-integration files that only prove one trivial success path and leave the real persistence/query behavior untested.

### Backend Suite Placement Heuristics

When choosing a backend suite, use this order:

1. `Unit`
- isolated logic
- no DB
- deterministic business-rule branches
- exhaustive business-logic coverage should live here when the logic can be proven without the DB

2. `Data Integration`
- persistence-layer unit proof
- CRUD and query behavior
- DB-backed edge cases
- lower-level route/service transitions that are not primary client journeys

3. `Contract Verification`
- DTO/OpenAPI alignment on representative endpoints
- response schema drift detection
- thin request/response shape checks

4. `Functional API (FAPI)`
- generated SDK
- real HTTP
- real product workflows
- auth/session behavior
- cross-endpoint business journeys
- client-visible error handling
- representative parameter combinations
- not exhaustive permutations already proven by unit/data integration

If a test could fit in both `Data Integration` and `FAPI`, prefer:
- `FAPI` for user/client workflows
- `Data Integration` for persistence edges, query correctness, and lower-level state invariants

Redundancy between suites is acceptable when each suite is true to its purpose. Do not delete a test merely because another layer also touches the same feature area. Remove a test only when it no longer serves its intended suite role.

### Browser E2E Tests (Playwright)

- Browser E2E should target only the PoolMaster web app.
- The current active browser lane is intentionally tiny and does block the deploy pipeline once QA deploy succeeds.
- The current deploy-gate journey is limited to: login page -> self-registration -> authenticated landing selector.
- Do not expand this deploy-gate lane into deeper product coverage until those product surfaces are intentionally designed and stabilized.

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
- Browser E2E must use machine-oriented selectors (`getByTestId`, stable `id`, or equivalent deterministic selectors) for workflow navigation and state assertions.
- Do not use visible copy selectors such as `getByText`, `getByRole({ name })`, or link/button text as the primary locator strategy in browser E2E unless the explicit purpose of the test is to validate user-facing copy.

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

Do not rely on `prisma migrate reset` to compensate for hidden inter-test
dependencies or bad cleanup. Tests must still be idempotent against a reused
database within normal local and CI execution.

However, the local `poolmaster_test` database is intentionally disposable. It
is acceptable to reset or recreate `poolmaster_test` before a validation run
when you need a clean migrated schema.

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

- Minimal deploy-gate authentication proof for the current primitive PoolMaster app
- High-value end-to-end user journeys aligned with the active product scope once the rebuilt app grows beyond the primitive baseline
- Error boundary absence on all tested pages
- Console error absence on all tested pages

---

## 11. What Not To Do

- Do not keep around tests that verify bad architecture.
- Do not preserve tests for no-op UI.
- Do not update mocks without checking whether the real contract changed.
- Do not hand-wave broken contract verification as “just generated client issues.”
- Do not skip OpenAPI validation after changing route schemas.
- Do not modify application code to make a test pass — see §1B *Forbidden Application-Code Patterns*. The conclusion is never "add a hardcoded response, fallback, or test-only branch to production code."
- Do not write a defect-fix slice without first writing a failing test that catches the defect — see §3 *Defect Verification Protocol*.
- Do not add a new test without a use-case, business-rule, or defect ID reference — see §1A *Test Self-Documentation*.

---

## 12. Documentation Drift Rules

If test strategy changes materially, update this file in the same work.

Examples:

- moving from manual client mocks to MSW
- changing smoke test locations or commands
- changing required local quality gates
- changing contract-validation expectations
