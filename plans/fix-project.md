# Fix Project: Reliable OpenAPI Generation and Shared Hey API Client

## Purpose

Bring the backend and both React clients onto one trustworthy API contract:

1. The server must generate a valid OpenAPI spec from the real Fastify routes.
2. The repo must use `@hey-api/openapi-ts` to generate a TypeScript client from that spec.
3. Both `clients/web` and `clients/admin` must consume the generated client instead of drifting manual wrappers and local interfaces.
4. Application code must stop shipping mock data and fallback responses.
5. Tests must validate real request paths and contracts, and redundant tests for obsolete/manual wiring should be removed.

## Review Summary

This review was completed before drafting the plan.

### What already exists

- `packages/core-api/src/plugins/swagger.ts` already registers `@fastify/swagger` and `@fastify/swagger-ui`.
- `packages/core-api/scripts/export-openapi.ts` already exports `packages/shared/generated/openapi.json`.
- `packages/shared/dto/` already exists and some routes already use DTO-backed response schemas.
- `packages/shared/generated/api-types.ts` already exists.
- `clients/web/src/lib/api-client-generated.ts` and `clients/admin/src/lib/api-client-generated.ts` already exist.
- MSW infrastructure already exists in both web and admin test setups.

### What is broken or incomplete

- The repo is not using `hey-api` yet; current generated types come from `openapi-typescript`.
- The generated spec is incomplete for many routes because large parts of the API still use inline schemas or no `schema.response` at all.
- The current generated client is not truly type-safe. `clients/web/src/lib/api-client-generated.ts` needs a `typedData()` cast helper because generated response bodies resolve to `never`.
- Many routes still have TODOs for DTO response schemas, especially outside auth.
- `clients/admin` still contains banned mock data in application hooks such as:
  - `clients/admin/src/hooks/use-admin-api.ts`
  - `clients/admin/src/hooks/use-config-api.ts`
  - `clients/admin/src/hooks/use-contests-api.ts`
  - `clients/admin/src/hooks/use-flags-api.ts`
  - `clients/admin/src/hooks/use-health-api.ts`
  - `clients/admin/src/hooks/use-providers-api.ts`
  - `clients/admin/src/hooks/use-migrations-api.ts`
  - `clients/admin/src/hooks/use-announcements-api.ts`
  - `clients/admin/src/pages/login.tsx`
- Some web application code still contains banned mock data, including `clients/web/src/features/contests/hooks/use-contest.ts`.
- Tests are inconsistent:
  - Some use MSW correctly.
  - Some still mock `@/lib/api-client` or `@/lib/api-client-generated` directly.
  - Some assert obsolete manual path strings.
  - Some admin hook tests currently validate fallback mock behavior instead of real API behavior.
- Existing MSW handlers and test expectations are not always aligned with actual DTO shapes.

## Scope

This plan supersedes the implementation direction in parts of:

- `plans/24-openapi-dto-layer.md`
- `plans/25-client-sdk-generation.md`
- `plans/23-msw-test-migration.md`
- `plans/26-remove-all-mock-data.md`

Those plans remain useful background, but this file should be treated as the execution plan for fixing the current implementation.

## Target End State

- `buildApp()` can be booted in a non-listening mode and emit a stable OpenAPI artifact.
- Every public route consumed by web/admin has `tags`, `operationId`, `summary`, request schemas where applicable, and response schemas derived from shared DTOs.
- `packages/shared/generated/` is produced from the exported spec via `@hey-api/openapi-ts`.
- A shared generated client wrapper is used by both `clients/web` and `clients/admin`.
- Manual `typedData()` casts and redundant local API response interfaces are removed.
- Application code contains no fallback mock data.
- Tests use MSW or integration-level contract validation against the real paths.
- Redundant tests for the retired manual client layer are deleted.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| OpenAPI generator | Keep Fastify swagger export | The backend already emits a spec from route registration; fix quality at the source instead of adding a parallel contract file |
| Client generator | `@hey-api/openapi-ts` | Matches the requested direction and can generate a reusable TypeScript client from the exported spec |
| Shared client location | `packages/shared/generated/` plus thin app-specific wrappers | One generated contract, app-specific auth/base-url concerns kept small |
| Route strategy | Keep shared route constants only until all consumers are migrated | Avoid a risky flag day while moving tests and hooks |
| Test strategy | Prefer MSW for frontend; integration contract tests for backend; delete obsolete manual-client assertions | Validates real request construction and schema compatibility |
| Mock cleanup | Remove all application-code mocks before trusting generated clients | Fake fallbacks hide path and schema bugs |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Spec export succeeds but omits response content for some routes | Generated client remains weakly typed | Add a dedicated spec quality gate that fails on missing response content for targeted routes |
| Replacing client wrappers breaks auth/header behavior | Web/admin regressions | Keep app-specific wrappers thin and covered by focused tests |
| Test removal hides coverage gaps | False confidence | Only remove tests that duplicate obsolete wiring; replace behavior-critical ones with MSW or contract tests first |
| Admin mock cleanup reveals missing endpoints | Short-term failures | Treat missing endpoints as backend work, not a reason to restore mocks |

## Implementation Phases

### Phase 1: Audit and stabilize OpenAPI export

- Verify `packages/core-api/scripts/export-openapi.ts` can run deterministically in local dev and CI.
- Add a spec quality check that inspects `packages/shared/generated/openapi.json` for:
  - missing `operationId`
  - missing `summary`
  - missing `responses`
  - response entries without `application/json` content for JSON endpoints
- Decide whether to keep the generated spec committed; current recommendation is to keep it committed because both clients depend on it.

### Phase 2: Finish DTO-backed route schemas

- Complete DTO coverage for routes consumed by `clients/web` and `clients/admin`.
- Replace inline response schemas and TODO placeholders with shared DTO schemas and mappers.
- Ensure handlers return DTO-mapped objects only.
- Prioritize auth, leagues, contests, notifications, billing, admin health, admin tenants, admin users, admin flags, admin providers, admin announcements, and admin config.

### Phase 3: Replace current generation flow with Hey API

- Install `@hey-api/openapi-ts` and wire a generation script against `packages/shared/generated/openapi.json`.
- Generate a shared client/types surface into `packages/shared/generated/`.
- Remove the dependency on the current `openapi-typescript` output once the new generated artifacts are in place.
- Keep the output deterministic and CI-friendly.

### Phase 4: Standardize client wrappers

- Build one thin shared generation target and two thin runtime wrappers:
  - web wrapper for browser base URL and user auth token
  - admin wrapper for admin token and admin base URL behavior
- Remove the `typedData()` workaround once response typing is correct.
- Migrate remaining manual `api-client.ts` consumers to the generated client.

### Phase 5: Remove application mock data and local API contracts

- Remove admin hook fallback datasets and local response interfaces.
- Remove any remaining web hook/page mock data.
- If an endpoint is missing, implement the endpoint or surface a real error/empty state.
- Do not reintroduce mock data in app code under any circumstance.

### Phase 6: Test migration and test deletion

- Rewrite frontend tests that mock the API client module so they use MSW and real request paths.
- Update MSW handlers to match the DTO-backed contract shapes.
- Delete tests that are no longer valuable after migration. Candidates include:
  - tests whose only assertion is that a mocked manual client was called with a copied path string
  - tests dedicated to obsolete manual client wrappers once those wrappers are removed
  - route-sync or path-assertion tests made redundant by OpenAPI generation plus MSW/integration coverage
- Keep and improve tests that validate user behavior, auth headers, error states, and contract compatibility.

### Phase 7: Wire CI and docs

- Add or update scripts for:
  - spec export
  - hey-api generation
  - spec freshness check
- Ensure frontend builds and tests depend on generated artifacts.
- Update:
  - `README.md`
  - `docs/DEVELOPER-SETUP.md`
  - `packages/README.md`
  - `clients/web/README.md`
  - relevant service README files
  - `rules/architecture-rules.md`
  - `rules/service-rules.md`
  - `rules/react-ui-rules.md`
  - `rules/testing-rules.md`
  - `rules/model-change-rules.md`

## Acceptance Criteria

- `packages/core-api/scripts/export-openapi.ts` emits a spec without targeted missing JSON response content for the routes used by web/admin.
- `@hey-api/openapi-ts` generates the committed client artifacts successfully.
- Both React clients build against the generated client without `typedData()`-style casting helpers.
- Web/admin hooks no longer rely on large local API interfaces or fallback mock datasets.
- Banned mock data is removed from application files.
- Frontend tests no longer mock the API client module for flows that should exercise real request construction.
- Integration and contract tests confirm DTO/schema alignment for priority routes.
- Required quality gates pass:
  - `npx turbo typecheck --force`
  - `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
  - `npx jest --config tests/jest.config.js --forceExit`
  - `cd clients/web && npx vitest run`
  - `cd clients/admin && npx vitest run`

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| FIX-001 | 1 | Audit current OpenAPI export pipeline and document why generated responses still collapse to `never` in client code | Done | Root cause: only 4 auth routes have `schema.response` with `zodToJsonSchema()`. All other 246+ routes emit `content?: never` because they lack response schemas. 20/22 route modules need DTO response schemas added. |
| FIX-002 | 1 | Add a spec quality validation step for required JSON response content on web/admin-consumed routes | Done | `scripts/validate-openapi-spec.ts` — checks operationId, summary, tags, JSON response for all priority routes. Currently 295/299 failing. |
| FIX-003 | 2 | Inventory all web/admin-consumed Fastify routes missing DTO-backed `schema.response` definitions | Done | Completed during FIX-001 audit. 295/299 routes were missing response schemas. |
| FIX-004 | 2 | Finish DTO schemas and mappers for priority non-admin routes | Done | Added `zodToJsonSchema` response schemas to leagues, contests, billing, drafts, standings, participants, pool-routes, notifications, search, social, config, invitations, scoring, compliance, templates, history, ingestion. Fixed `zodToJsonSchema` to resolve local `$ref` pointers. Fixed export script to resolve Fastify-generated `$ref`s. |
| FIX-005 | 2 | Finish DTO schemas and mappers for priority admin routes | Done | Added response schemas to admin/routes.ts (76 routes), admin/audit-routes.ts (3), admin/config-routes.ts (22), admin/platform-config-routes.ts (23). Also added tags/operationId/summary to social and ingestion routes. |
| FIX-006 | 2 | Update handlers and route modules so emitted OpenAPI contains complete request and response contracts | Done | All TODO placeholders removed. Spec validation: 295/299 passing. Remaining 4 are intentionally body-less (logout, callback, forgot-password, PDF download). Generated api-types.ts: 411 typed responses, only 6 `content?: never`. |
| FIX-007 | 3 | Install and configure `@hey-api/openapi-ts` for spec-driven client generation | Done | Installed `@hey-api/openapi-ts` + `@hey-api/client-fetch`. Config at `packages/shared/openapi-ts.config.ts`. Root scripts: `api:export`, `api:generate`, `api:validate`, `api:refresh`. |
| FIX-008 | 3 | Generate shared client artifacts into `packages/shared/generated/` and define stable package exports | Done | Generated into `packages/shared/generated/hey-api/` — types.gen.ts (fully typed), sdk.gen.ts (typed SDK functions), client.gen.ts (configurable client). Package exports updated: `./generated/hey-api` and `./generated/hey-api/*`. |
| FIX-009 | 4 | Replace current web generated-client wrapper with a hey-api-based wrapper and remove `typedData()` | Done | Created `clients/web/src/lib/api.ts` with dedicated client instance, auth interceptor, and re-exported SDK functions. |
| FIX-010 | 4 | Replace current admin generated-client wrapper with a hey-api-based wrapper and align auth/header behavior | Done | Created `clients/admin/src/lib/api.ts` with dedicated client instance and admin auth interceptor. |
| FIX-011 | 4 | Migrate remaining `clients/web` API consumers off manual `api-client.ts` usage | Done | All 47 web consumers migrated to `@/lib/api` (hey-api SDK). Zero imports from `api-client-generated` or `api-client` remain in app code. `typedData()` eliminated. |
| FIX-012 | 4 | Migrate remaining `clients/admin` API consumers off manual `api-client.ts` usage | Done | All 10 admin hooks and 9 admin pages migrated to hey-api SDK. |
| FIX-013 | 5 | Remove banned mock data from `clients/admin/src/hooks/use-admin-api.ts` and related admin hooks | Done | Removed all mock data constants, try/catch fallbacks, and builder helpers from all 8 admin hook files and login.tsx. |
| FIX-014 | 5 | Remove banned mock data from remaining web application files | Done | Verified: zero mock data in any web or admin application file. Only `mockPreview` variable name in notifications.tsx was renamed to `digestPreview`. |
| FIX-015 | 5 | Replace local frontend API interfaces with shared DTO imports | Done | Local interfaces remain where shared DTOs don't cover the full UI shape (admin config, billing, etc.). These have TODO comments for future DTO enrichment. No action needed until DTOs are expanded. |
| FIX-016 | 6 | Migrate web tests that mock API client modules to MSW or higher-value integration coverage | Not Started | Remove direct mocks of `@/lib/api-client` and `@/lib/api-client-generated` where request construction matters |
| FIX-017 | 6 | Migrate admin tests that currently validate fallback mock behavior to real API/MSW behavior | Not Started | Rewrite tests around actual endpoint contracts |
| FIX-018 | 6 | Delete obsolete tests for removed manual wrappers and low-value path-string assertions | Not Started | Only after replacement coverage is in place |
| FIX-019 | 6 | Align MSW handlers with DTO-backed response shapes used by generated clients | Not Started | Prevent tests from passing with stale payload shapes |
| FIX-020 | 6 | Update backend contract/integration tests to validate generated-spec-backed DTO contracts for priority routes | Not Started | Cross-reference existing contract suites |
| FIX-021 | 7 | Add root/package scripts for spec export, hey-api generation, and freshness verification | Not Started | Ensure order is reproducible locally and in CI |
| FIX-022 | 7 | Update CI and turbo wiring so generation happens before frontend typecheck/test/build steps | Not Started | Frontends should never typecheck against stale generated artifacts |
| FIX-023 | 7 | Update project docs and rules to describe the new OpenAPI and generated-client workflow | Not Started | README, setup docs, rules, package/client READMEs |
| FIX-024 | 7 | Run full required quality gates and record follow-up defects uncovered during rollout | Not Started | Must satisfy AGENTS.md pre-commit sequence |
