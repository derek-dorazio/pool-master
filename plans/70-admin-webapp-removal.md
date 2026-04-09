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
| Rules/docs references | `rules/architecture-rules.md`, `rules/workflow-rules.md`, `rules/react-ui-rules.md`, `rules/poolmaster-webapp-rules.md`, `plans/71-legacy-webapp-archive-and-cutover.md` | These now need later cleanup to stop treating admin as active guidance |
| Tests and helpers | `tests/integration/core-api/api-contracts-admin.integration.ts`, `tests/unit/core-api/admin-contest-service.test.ts`, `tests/api/jest.config.ts` | Admin contract/smoke-style coverage remains present |

Concrete removal map for later slices:

| Area | Planned removal target | Suggested order |
| --- | --- | --- |
| Local scripts | `package.json` admin smoke scripts | Remove after Plan 69 begins replacing the active web surface |
| CI unit/coverage | `.github/workflows/ci.yml` admin Vitest job, admin coverage upload, admin coverage summary | Remove with the admin-app gate cleanup slice |
| CI deploy | `.github/workflows/ci.yml` admin S3/CloudFront deploy steps and admin QA target references | Remove once the admin app is no longer an active deployment target |
| Browser E2E | `clients/admin/e2e/` and Playwright job wiring | Remove as part of the browser reset slice |
| Admin app source | `clients/admin/**` | Remove or archive only after the repo no longer needs it as active implementation guidance |
| Admin contract tests | `tests/integration/core-api/api-contracts-admin.integration.ts` | Remove once the new functional API suite owns the relevant contract/error coverage |
| Admin unit tests | `tests/unit/core-api/admin-contest-service.test.ts` and other admin-targeted unit suites | Remove or archive as the admin app is retired |
| Docs/rules | active references in `rules/*`, `AGENTS.md`, and plan docs | Update after the code/build references are removed so the guidance matches the repo state |

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory all `clients/admin` build/test/CI references | Active refs now mapped across package scripts, CI workflow, admin source/tests, and rules/docs; see inventory snapshot above |
| Done | Remove admin app from local quality gates | Root typecheck, lint, test, and coverage commands now target backend + PoolMaster only. |
| Done | Remove admin app from CI workflows | Admin build/test/coverage/deploy/browser references were removed from CI. |
| Pending | Remove admin-specific contract and browser test references | Clean up any admin-only contract or browser test wiring that should not survive the app retirement |
| Done | Remove or archive `clients/admin` source so it is no longer an active or discoverable implementation target | `clients/admin` was removed from the repo instead of being preserved as a transition target. |
| Done | Review and document deployed admin infrastructure impact | The retired admin deployment surface should be treated as deprecated infrastructure: QA/admin deploy targets, S3/CloudFront hooks, and any DNS/URL references should be removed or explicitly flagged as inactive in the deployment docs. |
| In Progress | Update docs and rules | Active rules, AGENTS, README, and setup guidance now point at the single-app direction; longer historical docs still need a cleanup pass. |
| Done | Add follow-up note for root-admin UI rebuild | Future root-admin browser workflows should be rebuilt from scratch in the single PoolMaster web app, not ported from the retired admin app. |

## Validation

- no active script or CI job references `clients/admin`
- no active rule or README treats admin as a maintained separate app
- repo build/test flow remains green without admin app participation
