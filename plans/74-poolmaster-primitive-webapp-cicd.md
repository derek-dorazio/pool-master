## Objective

Complete the end-to-end CI/CD path for the primitive PoolMaster webapp so the current minimal app can be built, tested, packaged, deployed, and verified in QA before deeper product design and implementation resumes.

## Why This Exists

The repo already builds and deploys `clients/poolmaster`, but the active browser E2E lane was intentionally reset during the legacy webapp/admin cleanup. Before evolving the new webapp further, we want one minimal post-deploy browser proof that:

- the deployed PoolMaster app loads
- the login/register page works against the live QA backend
- a real authenticated user lands on the authenticated member surface
- the authenticated landing surface exposes one stable selector for deploy-gate verification

This plan is deliberately narrow. It does not reintroduce broad browser journeys or deeper frontend functional coverage yet.

## Scope

In scope:

- minimal authenticated landing marker in the primitive PoolMaster app
- automatic redirect from successful login to the authenticated landing surface
- one Playwright browser test for self-registration -> authenticated landing
- CI wiring so the browser test runs only after successful QA deploy and migration/stabilization
- artifact upload and summary for browser failures

Out of scope:

- richer member journeys
- commissioner/root-admin browser flows
- frontend functional coverage beyond the existing Vitest lane
- broad browser test expansion

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Define the minimal deploy-gate browser journey and required stable selectors | Journey is: load `/`, self-register as a new commissioner, land on `/welcome`, assert one landing `data-testid`, and log out cleanly |
| Done | Add the authenticated landing marker and redirect behavior to the primitive PoolMaster app | The primitive authenticated landing marker exists on the zero-league welcome route, login/register now reach the authenticated app surface, and the page exposes `data-testid="authenticated-landing"` across loading/empty/success/error states |
| Done | Add Playwright config, one browser spec, and app-local scripts for PoolMaster | `clients/poolmaster/playwright.config.ts`, one Chromium spec, and app/root scripts are in place; the browser file uses a dedicated `.e2e.ts` suffix so it does not collide with Vitest |
| Done | Remove browser-lane dependency on QA bootstrap credentials | The browser proof now self-registers through the real UI with a unique email and no longer depends on seed/bootstrap secrets |
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
  - a brand-new commissioner can self-register against QA
  - minimal post-deploy browser E2E passes
