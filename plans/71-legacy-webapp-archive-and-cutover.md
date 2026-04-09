## Objective

Archive the legacy `clients/web` app so it no longer participates in active build, test, coverage, smoke, or CI workflows now that `clients/poolmaster` is the go-forward app.

The archived app may remain as reference material for planning only.

## Dependencies

- The immediate cleanup pivot allows this archive work to proceed before the full PoolMaster rebuild is complete, as long as PoolMaster is the only active frontend target in build/test/CI.
- Should coordinate with [plans/68-browser-e2e-reset-for-web-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/68-browser-e2e-reset-for-web-rebuild.md) and [plans/70-admin-webapp-removal.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/70-admin-webapp-removal.md) so test and CI references are removed cleanly.

## Direction

- `clients/web` should not be an active implementation target once the new PoolMaster app is underway.
- It may remain as archived/reference material for planning agents to infer use cases, layout ideas, and component ideas.
- Implementation agents should not keep it current with new plans or new backend contracts.
- All active frontend build/test/CI wiring should eventually point only to `clients/poolmaster`.
- This archived-reference allowance does not apply to `clients/admin`; the retired admin app should not be treated as planning or implementation guidance.

## Inventory

Historical inventory of the references that originally kept `clients/web` active:

- Build and local workflow:
  - [package.json](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/package.json) still exposes `test:smoke:e2e:web`, `test:smoke:e2e`, and `test:smoke`, all of which assume the legacy web app remains runnable.
  - [clients/web/package.json](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/package.json) still defines the legacy web app build, Vitest, and coverage entry points.
  - [clients/web/vite.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/vite.config.ts) still defines the legacy web app dev/build target and API proxy wiring.
  - [clients/web/vitest.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/vitest.config.ts) still defines the web app unit coverage thresholds and file globs.
  - [clients/web/playwright.config.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/playwright.config.ts) still defines the browser smoke-test target and the legacy QA base URL.
  - [clients/web/src/test-setup.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/test-setup.ts) still configures the legacy web app MSW test harness.

- CI and coverage:
  - [\.github/workflows/ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) still has the `test-webapp` job, the webapp coverage artifact/summary, the webapp build/deploy job, the smoke-test job, the Playwright job, and the webapp/admin coverage summary aggregation.
  - The same workflow still uploads `clients/web/coverage/*`, `clients/web/playwright-report/`, and `clients/web/test-results/`.

- Deploy and infrastructure:
  - [\.github/workflows/ci.yml](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/.github/workflows/ci.yml) still builds `clients/web` for QA S3/CloudFront deployment.
  - The workflow still deploys to the `poolmaster-qa-webapp` bucket and invalidates the QA webapp CloudFront distribution.
  - The same workflow still targets `https://qa.ultimateofficepoolmanager.com` as the webapp deployment target.

- Docs and repo guidance:
  - [README.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/README.md) still advertises the legacy web app as the active frontend, lists smoke/E2E commands, and links to `clients/web/README.md`.
  - [clients/web/README.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/README.md) is legacy app documentation that should become archived/reference-only.
  - [docs/DEVELOPER-SETUP.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/DEVELOPER-SETUP.md) still documents `clients/web` smoke and Playwright commands plus the old webapp setup flow.
  - [docs/AUTHENTICATION-AUTHORIZATION.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/AUTHENTICATION-AUTHORIZATION.md) still points at `clients/web` auth pages, API client, and auth store.
  - [docs/ARCHITECTURE.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/ARCHITECTURE.md) still describes the webapp/admin deployment split and legacy DNS targets.
  - [docs/HONEST-CONTRACT-REMEDIATION.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/HONEST-CONTRACT-REMEDIATION.md) still references `clients/web` feature areas as if the legacy app remains the active implementation target.

## Cutover Criteria

The legacy web app should stay archived and out of the active path as long as the new PoolMaster app remains the only frontend target in local and CI flows.

Current cutover baseline:

- new app handles basic auth and landing/shell
- new app is wired into active local build/test/CI flow
- new app is the only active deployed frontend target
- deeper feature rebuilding is intentionally paused pending the next discovery/planning phase

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Define and confirm the cutover point from `clients/web` to `clients/poolmaster` | The immediate cleanup pivot now treats PoolMaster as the sole active frontend target once auth/shell plus active build/test/CI wiring are in place. |
| Done | Inventory all active references to `clients/web` | Root scripts, web app package/config files, CI build/test/deploy jobs, coverage artifacts, and docs/README files still reference the legacy app; this inventory now lists the concrete cutover targets. |
| Done | Remove legacy web app from active build/test/coverage commands | Root scripts, lint/typecheck/build flow, and frontend test gates now target PoolMaster rather than the legacy web app. |
| Done | Remove legacy web app from smoke/browser/CI references | Legacy web Playwright/coverage/build references were removed from the active CI path. |
| Done | Archive `clients/web` as reference-only material | Moved to `clients/_archived/web` and added an archive warning for agents. |
| In Progress | Update rules, AGENTS guidance, and docs to mark it as archived | Active rules, AGENTS, README, and setup guidance now describe the archived legacy web app; a few historical docs still need follow-up cleanup. |
| Done | Inventory the future of `clients/shared` during cutover | `clients/shared` currently contains only placeholder directories (`api-client/`, `types/`, `validation/`) with no implementation files. Recommendation: remove the empty shell unless a new explicit shared frontend utility package is needed for `clients/poolmaster`; if any helper code is still required, move it into the active app or a clearly named shared package with a single consumer. |

## Validation

- active local and CI frontend gates target `clients/poolmaster`, not `clients/web`
- no active smoke/browser suite targets the archived app
- rules/docs clearly distinguish archived reference material from active implementation targets
