# Plan 70: Admin WebApp Removal

> Archived on 2026-04-09 after `clients/admin` was removed from the active repo surface and all related build, test, CI, and coverage references were cleaned up. Use this file only as historical cleanup context.

## Objective

Completely remove the separate admin webapp from the repository’s active build, test, and CI surface.

The long-term product direction is one role-based web app, not a separate admin frontend.

## Dependencies

- Can proceed independently of feature parity in the new PoolMaster app.
- Root-admin browser features will be rebuilt from scratch in the new PoolMaster app when needed; the old admin app is not a transition target.

## Direction

- Remove `clients/admin` as an active application target.
- Remove its build/test/coverage/Playwright/CI hooks.
- Remove repo rules and documentation that treat it as an active maintained app.
- Do not keep the old admin app around as a migration path or implementation reference.
- Any root-admin functionality needed later should be rebuilt from scratch inside the single PoolMaster web app.
- Archive only if needed for historical source retention; do not treat archived admin code as planning or implementation guidance.

## Follow-Up Note

- Future root-admin browser workflows should be planned as new PoolMaster features, not as a continuation of the retired admin app.
- The retired admin frontend is intentionally not a transition target, so no implementation work should depend on it for design references or parity tracking.

## Inventory Snapshot

Active admin references still present in the repo fall into these buckets:

| Bucket | Examples | Notes |
| --- | --- | --- |
| Root package scripts | `package.json` `test:smoke:e2e:admin`, `test:smoke:e2e`, `test:smoke` | Current local smoke command chain still dispatches admin Playwright |
| CI web/admin build and deploy | `.github/workflows/ci.yml` web/admin Vitest jobs, coverage upload, S3 deploy, QA summary | Both apps still participate in build/test/publish/QA deployment |
| Browser E2E | `clients/admin/e2e/` plus CI Playwright job | Admin browser suite still runs against `qa-admin.ultimateofficepoolmanager.com` |
| Admin app source | `clients/admin/` package and source files | Active app code, Vitest, Playwright, MSW, and UI remain in place |
| Rules/docs references | `rules/architecture-rules.md`, `rules/workflow-rules.md`, `rules/react-ui-rules.md`, `rules/poolmaster-webapp-rules.md`, `plans/archive/2026-04-service-and-frontend-baseline/71-legacy-webapp-archive-and-cutover.md` | These now need later cleanup to stop treating admin as active guidance |
| Tests and helpers | `tests/integration/core-api/api-contracts-root-admin.integration.ts`, `tests/unit/core-api/admin-contest-service.test.ts`, `tests/api/jest.config.ts` | Root-admin/backend contract coverage remains, but no separate admin-frontend contract suite or browser suite should survive |

Concrete removal map for later slices:

| Area | Planned removal target | Suggested order |
| --- | --- | --- |
| Local scripts | `package.json` admin smoke scripts | Remove after Plan 69 begins replacing the active web surface |
| CI unit/coverage | `.github/workflows/ci.yml` admin Vitest job, admin coverage upload, admin coverage summary | Remove with the admin-app gate cleanup slice |
| CI deploy | `.github/workflows/ci.yml` admin S3/CloudFront deploy steps and admin QA target references | Remove once the admin app is no longer an active deployment target |
| Browser E2E | `clients/admin/e2e/` and Playwright job wiring | Remove as part of the browser reset slice |
| Admin app source | `clients/admin/**` | Remove or archive only after the repo no longer needs it as active implementation guidance |
| Admin contract tests | `tests/integration/core-api/api-contracts-root-admin.integration.ts` | Keep only as backend/root-admin contract coverage rather than as a retired admin-frontend contract suite |
| Admin unit tests | `tests/unit/core-api/admin-contest-service.test.ts` and other admin-targeted unit suites | Remove or archive as the admin app is retired |
| Docs/rules | active references in `rules/*`, `AGENTS.md`, and plan docs | Update after the code/build references are removed so the guidance matches the repo state |

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory all `clients/admin` build/test/CI references | Active refs now mapped across package scripts, CI workflow, admin source/tests, and rules/docs; see inventory snapshot above |
| Done | Remove admin app from local quality gates | Root typecheck, lint, test, and coverage commands now target backend + PoolMaster only. |
| Done | Remove admin app from CI workflows | Admin build/test/coverage/deploy/browser references were removed from CI. |
| Done | Remove admin-specific contract and browser test references | Browser suite references were removed, and the old `api-contracts-admin.integration.ts` naming was retired in favor of a neutral root-admin/backend contract suite name. |
| Done | Remove or archive `clients/admin` source so it is no longer an active or discoverable implementation target | `clients/admin` was removed from the repo instead of being preserved as a transition target. |
| Done | Review and document deployed admin infrastructure impact | The retired admin deployment surface should be treated as deprecated infrastructure: QA/admin deploy targets, S3/CloudFront hooks, and any DNS/URL references should be removed or explicitly flagged as inactive in the deployment docs. |
| Done | Update docs and rules | Active rules and key architecture/auth guidance now point at the single-app direction and no longer treat the retired admin frontend as a maintained app. |
| Done | Add follow-up note for root-admin UI rebuild | Future root-admin browser workflows should be rebuilt from scratch in the single PoolMaster web app, not ported from the retired admin app. |

## Validation

- no active script or CI job references `clients/admin`
- no active rule or README treats admin as a maintained separate app
- repo build/test flow remains green without admin app participation
