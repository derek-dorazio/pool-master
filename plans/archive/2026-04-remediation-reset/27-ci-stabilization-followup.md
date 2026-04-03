# Plan 27: CI Stabilization Follow-Up

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Purpose

Address the failures surfaced by GitHub Actions after the generated-client and OpenAPI refactor, with priority on fixing the real code and build/runtime problems first, and only then updating tests and CI wiring around the repaired behavior.

This follow-up plan exists because the local quality gates passed, but CI exposed two important classes of issues:

1. A production build/module-resolution failure in `clients/admin`
2. Broader backend integration failures that were masked locally by incomplete infrastructure parity

Smoke tests and browser E2E were **not** executed on the failed run because upstream jobs failed first.

## Triggering CI Findings

Source run:
- [CI run #177](https://github.com/derek-dorazio/pool-master/actions/runs/23928830427)

Commit under test:
- `19be2c4` — `Migrate apps to generated OpenAPI client`

### Job outcomes

- `lint-typecheck`: passed
- `test-webapp`: passed
- `test-admin`: passed
- `build`: failed
- `test` (backend unit + integration): failed
- `smoke-test`: skipped
- `e2e-test`: skipped

## Findings Summary

### Finding 1: Admin production build import resolution is broken in CI

The `build` job failed in `@poolmaster/admin` during `vite build`.

Error excerpt:

```text
[vite:load-fallback] Could not load .../packages/shared/generated/api-types.ts/hey-api/client
ENOTDIR: not a directory
```

Interpretation:

- The admin app builds locally but fails in CI production bundling.
- The generated-client import path resolution is interacting badly with shared package exports and/or a stale `api-types.ts` path collision during Vite resolution.
- This is a real build defect, not a test-only issue.

### Finding 2: Backend integration suite is failing with real 500s and test-environment drift

The `test` job passed backend unit tests but failed many integration suites.

Representative failures:

- `tests/integration/core-api/schema-validation.integration.ts`
- `tests/integration/core-api/api-contracts-web.integration.ts`
- `tests/integration/core-api/contest-handler.integration.ts`
- `tests/integration/core-api/billing-deep.integration.ts`
- `tests/integration/core-api/compliance-deep.integration.ts`
- `tests/integration/core-api/search.integration.ts`
- `tests/integration/core-api/social.integration.ts`
- `tests/integration/core-api/history-deep.integration.ts`

Observed symptoms:

- Many expected `201` or `200` responses returned `500`
- Prisma repository integration failures surfaced
- cleanup logic and SQL assumptions are drifting from the migrated schema:
  - `operator does not exist: uuid = text`
  - missing relation errors such as `contest_participant_pools`
  - missing relation errors such as `commissioner_audit_logs`

Interpretation:

- There are likely real backend defects behind at least some of the `500`s.
- There is also test helper / cleanup code that is no longer valid for the current schema.
- We should not “fix the tests” first. We need to isolate:
  - actual backend regressions
  - stale cleanup/setup infrastructure
  - stale integration assertions that assume pre-refactor shapes

### Finding 3: Smoke and browser E2E status is unknown because they were gated off

The `smoke-test` and `e2e-test` jobs were skipped due to upstream failure.

Implication:

- We do **not** yet know whether the deployed smoke/browser suites pass on the refactor.
- The immediate goal is to repair the build + integration pipeline so those later jobs can run.

## Scope

This plan is a follow-up to:

- `plans/fix-project.md`
- `plans/25-client-sdk-generation.md`
- `plans/23-msw-test-migration.md`

It should be treated as the active plan for resolving the latest CI findings before further rollout confidence work.

## Priorities

### Priority 1

Fix the real code and build/runtime problems:

- production build path resolution in admin
- actual backend 500s/regressions exposed by integration

### Priority 2

Repair stale test infrastructure only where it is truly wrong for the current codebase:

- integration DB cleanup/setup drift
- stale schema assumptions
- test helper type mismatches

### Priority 3

Only after the above:

- rerun CI
- verify smoke and browser E2E
- adjust smoke/E2E if they are asserting retired behavior

## Implementation Phases

### Phase 1: Fix shared generated-client build resolution

- Reproduce the CI production build failure locally using the same build command path as GitHub Actions.
- Inspect package export resolution for:
  - `packages/shared/package.json`
  - Vite alias behavior in both apps
  - any stale import collision involving `generated/api-types.ts`
- Remove or update legacy generated-client surfaces that can confuse production resolution.
- Ensure both `clients/web` and `clients/admin` build cleanly via `npx turbo build`, not just typecheck.

### Phase 2: Triage backend integration failures into real defects vs stale test infra

- Reproduce failing integration suites against local container-backed infra.
- Start with the first creation path that now returns `500` instead of `201`.
- Identify the true root causes behind:
  - create-flow failures
  - repository failures
  - billing/compliance/search/history/social regressions
- Separate failures into:
  - application defects
  - repository/schema drift
  - setup/cleanup/test helper drift

### Phase 3: Fix backend application/runtime defects

- Repair any route/handler/service regressions causing live `500`s.
- Repair any repository/Prisma usage mismatches exposed by integration.
- Update DTOs/mappers/contracts if the failures reflect broken contract assumptions.
- Keep priority on making the app behave correctly rather than preserving old test assumptions.

### Phase 4: Repair integration harness and cleanup logic

- Update test helper cleanup SQL and repository setup to match current schema.
- Remove references to dropped or renamed relations/tables.
- Fix UUID/text comparison issues in cleanup queries.
- Ensure integration helpers do not assume stale table names or stale tenant column types.

### Phase 5: Reconcile contract/integration assertions with current architecture

- Once the app and cleanup logic are fixed, update only the tests that still assume retired behavior.
- Preserve high-signal contract and integration coverage.
- Remove or replace stale assertions that are enforcing pre-refactor shapes or paths.

### Phase 6: Re-run CI-critical path locally

- `npx turbo build`
- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- `npx jest --config tests/jest.config.js --forceExit`
- `cd clients/web && npx vitest run`
- `cd clients/admin && npx vitest run`
- `npm run api:refresh`
- `npm run api:validate`

### Phase 7: Verify smoke and browser E2E after upstream fixes are green

- Push the repaired branch/commit and verify CI reaches:
  - `smoke-test`
  - `e2e-test`
- If those suites fail, treat them as second-order findings:
  - real deployed regression first
  - stale test expectation second
- Update smoke/E2E only after confirming the intended runtime behavior.

## Acceptance Criteria

- `npx turbo build` passes locally and in CI.
- The admin app no longer resolves generated-client imports through a broken `api-types.ts` path.
- Backend integration tests no longer fail with broad `500` responses caused by the refactor.
- Integration cleanup/setup code matches the current schema and tenant ID typing.
- CI reaches and executes the `smoke-test` and `e2e-test` jobs.
- Smoke/browser failures, if any remain, are narrowed to real deployed behavior rather than upstream build/test blockage.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| CI-001 | 1 | Reproduce the CI admin production build failure locally with `npx turbo build` | Done | Reproduced from CI logs and local config audit: the broad `@poolmaster/shared/generated` Vite alias was swallowing `@poolmaster/shared/generated/hey-api/*` imports and resolving them through `generated/api-types.ts`. |
| CI-002 | 1 | Audit shared package exports and legacy generated-client files for path-resolution conflicts | Done | Shared package exports were already compatible; the real collision was app-side alias ordering. Added explicit `@poolmaster/shared/generated/hey-api` aliases in both Vite configs to preserve the generated SDK subpath. |
| CI-003 | 1 | Fix admin generated-client import resolution so CI production build passes | Done | `npm run build` passes in both `clients/admin` and `clients/web`, and `npx turbo build --filter=@poolmaster/admin --filter=@poolmaster/web --filter=@poolmaster/shared` now completes without the CI `ENOTDIR` failure. |
| CI-004 | 2 | Reproduce failing backend integration suites against local container-backed infra | Done | Replayed the DB-backed suites against the user's local Postgres and narrowed the failures to concrete contract/runtime defects: placeholder Fastify response schemas, route shadowing in drafts, billing invoice envelope drift, contest override response mismatches, and stale cleanup SQL. |
| CI-005 | 2 | Classify integration failures into application defects, repository/schema drift, and stale test harness issues | Done | Separated real app defects from stale tests/helpers. The dominant app defect was response-schema drift; helper drift was fixed in `tests/integration/helpers.ts`; stale assertions were updated only after the API behavior was repaired. |
| CI-006 | 3 | Fix backend runtime regressions causing `500` responses in create/contract flows | Done | Added shared DTO coverage and mapper wiring across participants, standings, templates, search, social, notifications, compliance, history, leagues, contests, billing, and drafts. Fixed draft template route shadowing, pool search response schema, billing invoice envelopes, contest override responses, and contest DTO timestamps. Full integration suite is now green. |
| CI-007 | 3 | Fix repository/Prisma validation issues exposed by adapter and draft-entry integration tests | Done | Repository/test-data issues were resolved as part of the broader integration stabilization pass. `adapters.integration.ts`, `draft-entries.integration.ts`, `pool-operations.integration.ts`, and related suites now pass against the live test DB. |
| CI-008 | 4 | Update integration cleanup/setup helpers to match current schema and UUID typing | Done | Cleanup SQL now casts tenant comparisons as `uuid` and uses the current table names `contest_participant_pool` and `commissioner_audit_log`. Verified by a full green `npm run test:integration` run. |
| CI-009 | 4 | Remove or rewrite stale integration assumptions that no longer match the current schema model | Done | Updated stale auth/logout expectations earlier, preserved high-signal suites, and removed the remaining assumptions that were still encoding placeholder response envelopes or route-shadowed draft template behavior. |
| CI-010 | 5 | Reconcile contract and integration assertions with the repaired API behavior | Done | `api-contracts-web.integration.ts`, draft template integration tests, and contest lifecycle/override tests now align with the repaired API contracts instead of the broken pre-fix behavior. |
| CI-011 | 6 | Re-run full local CI-critical path including `npx turbo build` | Done | Confirmed green on `npx turbo typecheck --force`, `npx jest --config tests/jest.config.js --forceExit`, `cd clients/web && npx vitest run`, `cd clients/admin && npx vitest run`, full `npm run test:integration` on the local Postgres-backed environment, plus final reruns of `npx turbo build --filter=@poolmaster/shared --filter=@poolmaster/core-api --filter=@poolmaster/web --filter=@poolmaster/admin`, `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`, `npm run api:refresh`, and `npm run api:validate` after converting the remaining delete endpoints to explicit JSON success responses. |
| CI-012 | 7 | Push fixes and verify GitHub Actions reaches smoke and browser E2E jobs | Not Started | This is the first point where smoke/E2E status becomes meaningful |
| CI-013 | 7 | Review smoke and browser E2E failures, if any, and update only after confirming intended behavior | Not Started | Fix product/runtime first, tests second |
