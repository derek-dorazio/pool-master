# Browser E2E High-Value Rebuild

> **Planning Note (2026-04-09):** This is the deferred browser-E2E rebuild note for the new `clients/poolmaster` app. Re-analyze the deployed QA behavior, auth flow, and available stable test data before implementing this plan. Do not reintroduce brittle multi-step browser journeys into the CI deploy gate until they are proven stable outside that gate.
>
> **Update (2026-04-23):** The preferred rebuild strategy is now reusable QA
> fixture accounts plus a self-healing shared `QA-TEST-LEAGUE`, not per-run
> random durable users and leagues. See
> [105-test-data-hygiene-and-shared-qa-browser-fixtures.md](../105-test-data-hygiene-and-shared-qa-browser-fixtures.md).

## Purpose

Rebuild a higher-value browser E2E suite that covers real MVP journeys in the new PoolMaster web app, but keep it separate from the minimal deploy-gate browser smoke until the environment and data setup are stable enough.

## Why This Is Deferred

The previous MVP browser journey suite was removed from the deploy gate because it was too brittle relative to the signal it provided. The environment now has stronger backend functional coverage and a fresh PoolMaster frontend baseline, so the next browser phase should be built more deliberately rather than patched in CI.

As of 2026-04-20, richer browser E2E remains intentionally deferred not only
because of environment/data setup, but also because the lower-layer automated
proof is still being strengthened. Browser E2E should not be relied upon to
discover ordinary coding defects that should have failed local unit,
integration, contract, or functional suites first.

## Target Journeys

1. Commissioner creates league and invites a member
2. Member accepts invite and appears in league membership UI
3. Commissioner creates a supported MVP contest from live or mock contest feed data
4. Participant enters a contest and reaches the selection room
5. User can review contest detail, standings, and results after setup

## Preconditions

- QA/browser test data source is stable
- The `mock-contest-feed-provider` is available for predictable ingestion-driven flows, or equivalent stable QA data exists
- Public auth and invitation flows are stable outside the deploy-gate CI lane
- Browser artifacts and traces are uploaded reliably in CI

## Principles

- Use real browser interactions, not injected app state
- Keep each journey self-owned where practical
- Prefer deterministic data sources over ambient QA fixture assumptions
- Use resilient selectors and explicit step assertions
- Split long journeys into separate specs so failures are easier to diagnose

## Suggested Rebuild Order

1. Invite/member journey
   - commissioner registers or logs in
   - commissioner creates league
   - commissioner generates invite link
   - second user joins through the real browser flow

2. Contest setup journey
   - commissioner creates league
   - commissioner creates a supported MVP contest from predictable ingested data
   - lands on contest detail

3. Contest participation journey
   - participant joins contest
   - enters or completes selection flow
   - lands on contest review surface

4. Results/standings journey
   - uses deterministic contest data
   - validates basic read flows only

## Execution Strategy

- Start outside the deploy gate
- Run in ad hoc QA verification or a non-blocking CI lane first
- Promote only the most reliable subset into required CI after repeated stable runs
- Do not resume this plan until the active non-E2E use-case coverage remediation
  lane has materially improved lower-layer proof for the same workflows

## Acceptance Criteria

- The rebuilt browser suite exercises real MVP product value, not just public page render
- The suite does not depend on one-off ambient residue. Reusable QA fixtures
  are acceptable only when the harness truthfully verifies or repairs the
  prerequisite state it needs.
- The suite is deterministic enough to run repeatedly without frequent manual repair
- Only stable journeys are promoted into required CI

## Follow-Up

- This file is the deferred richer suite for the rebuilt PoolMaster web app.
- Use [plans/69-poolmaster-webapp-rebuild.md](../69-poolmaster-webapp-rebuild.md) as the product-side prerequisite for when this suite should be resumed.

## Execution Notes

- 2026-04-19: Added first-pass Playwright journeys in `clients/poolmaster/e2e/` for:
  - commissioner league creation plus invite-link generation
  - member invite acceptance plus league join
- 2026-04-20: The two richer contest browser journeys were removed from the
  active deploy-gate suite because QA does not yet provide deterministic
  contest-ready event data for them. Reintroduce them only after explicit test
  data setup exists for event/field readiness.
- These still stop short of browser coverage for locked-entry/history/final-standings verification, which remains the next expansion area for this suite.
