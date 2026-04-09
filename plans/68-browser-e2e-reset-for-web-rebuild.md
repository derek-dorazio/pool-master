## Objective

Clear out the current browser E2E suites so they do not preserve stale web/admin behavior after the backend refactor.

The admin app is being retired, and the web app will be rebuilt against the new backend model. The existing browser E2E suites should therefore be treated as stale and removed rather than incrementally patched.

This direction is also captured in:

- [plans/69-poolmaster-webapp-rebuild.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/69-poolmaster-webapp-rebuild.md)
- [plans/70-admin-webapp-removal.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/70-admin-webapp-removal.md)
- [plans/71-legacy-webapp-archive-and-cutover.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/71-legacy-webapp-archive-and-cutover.md)

## Direction

- Remove current Playwright/browser E2E suites that target the pre-refactor web/admin experiences.
- Do not preserve those suites as active quality gates.
- Reintroduce a small, comprehensive post-deploy browser suite later, once the new web application exists.
- Do not preserve the old admin browser suite as a migration aid or implementation reference.

This plan should execute alongside the webapp cutover plans rather than as a standalone testing-only cleanup.

This plan is blocked until:

- the replacement local/CI confidence strategy from Plans 66 and 67 is active
- the webapp cutover direction in Plans 69, 70, and 71 is the active frontend path

## Future Desired State

When the new web app is ready, create a fresh post-deploy browser E2E suite with a small number of high-value full user journeys, such as:

- register/login and reach authenticated home
- join league via invite
- commissioner creates contest
- member creates entry and makes selections
- standings/history read path

These should be rebuilt from scratch against the new application, not adapted from the old suites.

When rebuilt, carry forward the useful parts of the old Playwright support pattern such as:

- console error capture
- `pageerror` capture
- 5xx response capture
- shared fixture wiring for browser diagnostics

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Inventory current browser E2E suites and workflow hooks | Current browser refs are concentrated in `package.json` smoke scripts (`test:smoke:e2e:web`, `test:smoke:e2e:admin`, `test:smoke:e2e`, `test:smoke`) and `.github/workflows/ci.yml` jobs that run `clients/web && npx playwright test`, `clients/admin && npx playwright test`, install Playwright browsers, upload `playwright-report`/`test-results`, and include browser coverage/deploy dependencies. Web suite files: `clients/web/playwright.config.ts`, `clients/web/e2e/fixtures.ts`, `clients/web/e2e/mvp-browser.smoke.ts`. Admin suite files: `clients/admin/playwright.config.ts`, `clients/admin/e2e/fixtures.ts`, `clients/admin/e2e/mvp-admin.smoke.ts`. Reusable pattern worth preserving later: the shared runtime error tracker in both fixture files plus `assertNoErrorBoundary` in the web suite. Plan 70 now owns admin-app removal and Plan 71 owns legacy web archival, so this plan stays focused on browser-suite reset rather than app removal itself. |
| Done | Remove admin Playwright suite | `clients/admin` was removed from the repo, including its Playwright fixtures and tests. |
| Done | Remove stale web Playwright suite | Removed the archived legacy web Playwright config and stale browser smoke files so the future browser suite starts clean. |
| Done | Remove Playwright browser gating from active CI/local quality gates | Root scripts, CI jobs, and active rule/docs guidance no longer run or require Playwright. |
| Done | Coordinate admin test removal with Plan 70 | Admin frontend test gates were removed alongside app retirement. |
| Done | Update testing strategy docs | Repo guidance now states browser E2E is intentionally reset until the new PoolMaster suite is rebuilt. |
| Done | Create a deferred rebuild note for future browser E2E reintroduction | [plans/testing/browser-e2e-high-value.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/browser-e2e-high-value.md) now captures the deferred high-value browser suite for the rebuilt PoolMaster app. |

## Validation

- No active CI/local gate depends on stale browser suites
- Documentation no longer treats the old Playwright suites as current
- Future browser testing is clearly documented as a rebuild task tied to the new web application
