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
| Pending | Inventory current browser E2E suites and workflow hooks | Web + admin Playwright tests, scripts, CI jobs, docs |
| Pending | Remove admin Playwright suite | Admin app is being retired |
| Pending | Remove stale web Playwright suite | Existing flows target pre-refactor UI assumptions |
| Pending | Remove Playwright browser gating from active CI/local quality gates | Update package scripts, workflow jobs, and rules/docs accordingly |
| Pending | Coordinate admin test removal with Plan 70 | Do not leave `clients/admin` Playwright/Vitest or other frontend test gates active after the app is retired |
| Pending | Update testing strategy docs | State that browser E2E is intentionally reset until the new web app exists |
| Pending | Create a deferred rebuild note for future browser E2E reintroduction | Tie reintroduction to the PoolMaster webapp rebuild milestone and keep the future suite intentionally small and use-case driven |

## Validation

- No active CI/local gate depends on stale browser suites
- Documentation no longer treats the old Playwright suites as current
- Future browser testing is clearly documented as a rebuild task tied to the new web application
