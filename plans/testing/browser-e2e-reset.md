# Browser E2E Reset

> **Planning Note (2026-04-03):** Re-analyze the current MVP routes, auth flow, and browser environment assumptions before extending this plan. Do not preserve shallow page-load suites just because they already exist.

## Purpose

Rebuild browser E2E coverage so it proves the narrowed MVP user journey instead of only checking that public pages render.

## Why The Old Browser Layer Needs Reset

The existing Playwright suites are low-signal because they:

- focus heavily on public landing/legal page rendering
- do not prove the core product path end to end
- inject auth state directly instead of favoring the real product setup path
- leave major MVP seams untested: league creation, invite acceptance, contest creation, entry, selection room, and review surfaces
- include shallow route checks and dashboard navigation checks that are better covered by smoke or component tests

Current files that should be replaced rather than preserved:

- `clients/web/e2e/smoke.smoke.ts`
- `clients/web/e2e/user-journey.smoke.ts`

Replacement target:

- `clients/web/e2e/mvp-browser.smoke.ts`

## Browser E2E Principles

- Focus on one or two high-value flows, not broad page inventory.
- Prefer real browser actions over injected app state when practical.
- Use setup helpers only to reduce duplication, not to bypass the product.
- Keep selectors resilient and user-oriented.
- Fail on console errors, uncaught exceptions, server 5xxs, and visible error boundaries.

## MVP Browser Scope

1. Contest setup path
   - register or login through the real browser UI
   - create league
   - create a live MVP contest from ingested event data
   - land on the contest detail page after submit

2. Invite/member path
   - commissioner creates league
   - commissioner generates invite link
   - second user accepts invite through the browser
   - member appears in league member UI

## Explicitly Out Of Scope

- broad legal/public page inventory as primary E2E coverage
- deferred billing flows
- bracket/deferred contest families
- season-long or weekly reset contest families
- admin depth

## Rebuild Order

1. Browser fixtures reset
   - Status: Completed
   - keep runtime-error capture
   - export tracker helpers for secondary browser contexts

2. Contest setup browser flow
   - Status: In Progress
   - real auth
   - create league
   - create contest from live events/templates
   - land on contest detail

3. Invite/member browser flow
   - Status: In Progress
   - commissioner invite
   - member accept
   - member list reflects joined user

## Suggested Worker Lanes

- Browser fixtures and auth setup cleanup
- Contest setup browser flow rewrite
- Invite/member browser flow rewrite

## Acceptance Criteria

- Legacy browser smoke suites are deleted or replaced.
- New E2E suites prove the narrowed MVP product flow, not just page rendering.
- Browser suites fail on real runtime defects.
- The suite is small enough to run reliably post-deploy.
