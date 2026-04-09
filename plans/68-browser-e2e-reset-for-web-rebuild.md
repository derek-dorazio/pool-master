## Objective

Clear out the current browser E2E suites so they do not preserve stale web/admin behavior after the backend refactor.

The admin app is being retired, and the web app will be rebuilt against the new backend model. The existing browser E2E suites should therefore be treated as stale and removed rather than incrementally patched.

## Direction

- Remove current Playwright/browser E2E suites that target the pre-refactor web/admin experiences.
- Do not preserve those suites as active quality gates.
- Reintroduce a small, comprehensive post-deploy browser suite later, once the new web application exists.

## Future Desired State

When the new web app is ready, create a fresh post-deploy browser E2E suite with a small number of high-value full user journeys, such as:

- register/login and reach authenticated home
- join league via invite
- commissioner creates contest
- member creates entry and makes selections
- standings/history read path

These should be rebuilt from scratch against the new application, not adapted from the old suites.

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Pending | Inventory current browser E2E suites and workflow hooks | Web + admin Playwright tests, scripts, CI jobs, docs |
| Pending | Remove admin Playwright suite | Admin app is being retired |
| Pending | Remove stale web Playwright suite | Existing flows target pre-refactor UI assumptions |
| Pending | Remove Playwright browser gating from active CI/local quality gates | Update package scripts, workflow jobs, and rules/docs accordingly |
| Pending | Update testing strategy docs | State that browser E2E is intentionally reset until the new web app exists |
| Pending | Create a deferred rebuild note for future browser E2E reintroduction | Keep the future suite intentionally small and use-case driven |

## Validation

- No active CI/local gate depends on stale browser suites
- Documentation no longer treats the old Playwright suites as current
- Future browser testing is clearly documented as a rebuild task tied to the new web application
