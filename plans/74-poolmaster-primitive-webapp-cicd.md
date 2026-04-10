## Objective

Complete the end-to-end CI/CD path for the primitive PoolMaster webapp so the current minimal app can be built, tested, packaged, deployed, and verified in QA before deeper product design and implementation resumes.

## Why This Exists

The repo already builds and deploys `clients/poolmaster`, but the active browser E2E lane was intentionally reset during the legacy webapp/admin cleanup. Before evolving the new webapp further, we want one minimal post-deploy browser proof that:

- the deployed PoolMaster app loads
- the login page works against the live QA backend
- a real authenticated user lands on the authenticated member surface
- the authenticated landing surface exposes one stable selector for deploy-gate verification

This plan is deliberately narrow. It does not reintroduce broad browser journeys or deeper frontend functional coverage yet.

## Scope

In scope:

- minimal authenticated landing marker in the primitive PoolMaster app
- automatic redirect from successful login to the authenticated landing surface
- one real QA bootstrap login user created through the existing seed path
- one Playwright browser test for login -> authenticated landing
- CI wiring so the browser test runs only after successful QA deploy and migration/seed/stabilization
- artifact upload and summary for browser failures

Out of scope:

- richer member journeys
- commissioner/root-admin browser flows
- frontend functional coverage beyond the existing Vitest lane
- broad browser test expansion

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Define the minimal deploy-gate browser journey and required stable selectors | Journey is: load `/`, log in with QA bootstrap user, land on authenticated PoolMaster page, assert one landing `data-testid` only |
| Done | Add the authenticated landing marker and redirect behavior to the primitive PoolMaster app | `/leagues` is now the authenticated landing target, login/register redirect there, and the page exposes `data-testid="authenticated-landing"` across loading/empty/success/error states |
| Done | Add Playwright config, one browser spec, and app-local scripts for PoolMaster | `clients/poolmaster/playwright.config.ts`, one Chromium spec, and app/root scripts are in place; the browser file uses a dedicated `.e2e.ts` suffix so it does not collide with Vitest |
| Done | Wire QA seed/bootstrap env for one real browser-login user | CI uses `QA_ROOT_ADMIN_EMAIL` and `QA_ROOT_ADMIN_PASSWORD` when configured, then passes them into the existing seed path as `ROOT_ADMIN_*` env values; until those secrets exist, the seed/bootstrap and browser lane skip explicitly rather than failing deploy |
| Done | Add post-deploy PoolMaster browser E2E job to CI | `poolmaster-browser-e2e` now runs after `migrate-qa` on push to `main` |
| Done | Upload Playwright artifacts and summarize the browser result in CI | Browser artifact upload and a concise summary are now part of the new CI job |
| Done | Emit deployable PoolMaster version metadata and add an app-side reader | The PoolMaster build now writes `dist/version-info.json` with webapp/service versions, SHAs, build time, and release context; the app exposes `getVersionInfo()` as the typed reader |
| Done | Update testing/docs/rules references for the restored minimal browser lane | Testing rules and setup docs now describe the intentionally tiny deploy-gate browser lane |
| In Progress | Validate locally where feasible and push to verify full CI/CD path | Local typecheck, lint, Vitest, and Playwright suite discovery pass. Full browser execution is deferred to CI because this sandbox is not the deployed QA target |

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/poolmaster/src/**/*.{ts,tsx}' --max-warnings 0`
- `cd clients/poolmaster && npx vitest run`
- `cd clients/poolmaster && npx playwright test --list`
- CI run proves:
  - PoolMaster builds
  - PoolMaster deploys to QA
  - QA seed creates the bootstrap browser-login user
  - minimal post-deploy browser E2E passes
