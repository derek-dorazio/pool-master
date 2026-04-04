# Browser E2E Reset

> **Planning Note (2026-04-03):** Re-analyze the current MVP routes, auth flow, and browser environment assumptions before extending this plan. Do not preserve shallow page-load suites just because they already exist.

## Purpose

Keep the deployed browser lane small and reliable for CI while planning a later rebuild of higher-value MVP browser journeys.

## Current Decision

The earlier MVP browser journeys were valuable in theory, but they are still too flaky for the deployed CI lane right now. Until the broader QA environment and test data strategy are more stable, the browser suite should only verify that:

- the deployed frontend loads
- public auth entry points render
- basic navigation works
- runtime errors, uncaught exceptions, and visible error boundaries are still treated as failures

Richer browser coverage is deferred to a later rebuild.

Current browser file:

- `clients/web/e2e/mvp-browser.smoke.ts`
  - intentionally minimal CI sanity checks only

## Browser E2E Principles For The Current CI Lane

- Keep the suite minimal and stable.
- Avoid deep multi-user or multi-step product flows in the deploy gate.
- Prefer pages that do not require seeded fixture data or brittle async setup.
- Keep selectors resilient and user-oriented.
- Fail on console errors, uncaught exceptions, server 5xxs, and visible error boundaries.

## Current Browser Scope

1. Landing page loads
2. Registration page loads
3. Login page loads

## Explicitly Out Of Scope

- deep product journeys in the deploy gate
- multi-user invite/member flows
- live contest creation flows
- selection room flows
- standings/results review flows
- deferred billing flows
- bracket/deferred contest families
- season-long or weekly reset contest families
- admin depth

## Current Implementation Status

1. Browser fixtures reset
   - Status: Completed
   - keep runtime-error capture

2. Minimal deploy-gate browser smoke
   - Status: Completed
   - landing page render
   - registration page render
   - login page render

3. High-value browser rebuild
   - Status: Deferred
   - move to a future dedicated plan once QA/browser data dependencies are more stable

## Follow-Up Plan

- See `plans/testing/browser-e2e-high-value.md` for the deferred richer suite.

## Acceptance Criteria

- The deploy-gate browser suite is small enough to run reliably post-deploy.
- Browser checks still fail on real runtime defects.
- Richer product journeys are tracked separately rather than kept as flaky CI gates.
