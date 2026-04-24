# Plan 105: Test Data Hygiene and Reusable QA Browser Fixtures

**Beads epic:** `pool-master-xw5` — see `bd show pool-master-xw5` for live slice state, child stories, and status. This plan is the narrative companion; task tracking lives in Beads.

## Objective

Stop both QA and local Postgres from accumulating avoidable automated-test
residue by:

- replacing per-run browser-created users/leagues with reusable QA fixtures
- hardening local functional/integration cleanup and reset behavior
- using real lifecycle cleanup flows for manual QA cleanup where they already
  exist

## Dependencies

- [86-e2e-stabilization-and-cleanup-reset.md](./86-e2e-stabilization-and-cleanup-reset.md)
- [83-league-lifecycle-execution.md](./83-league-lifecycle-execution.md)
- [85-user-account-lifecycle-execution.md](./85-user-account-lifecycle-execution.md)
- [plans/testing/browser-e2e-high-value.md](./testing/browser-e2e-high-value.md)

## Confirmed Current State

- Browser E2E currently creates unique users and league codes on each run in
  `clients/poolmaster/e2e/`, which causes permanent QA residue.
- Local functional and integration suites currently use best-effort cleanup
  against a shared Postgres database rather than per-test transaction rollback.
- League delete with contest/member cascade cleanup already exists under
  [83-league-lifecycle-execution.md](./83-league-lifecycle-execution.md).
- Self-account inactivate/delete already exists under
  [85-user-account-lifecycle-execution.md](./85-user-account-lifecycle-execution.md).
- Draft contest delete and member entry delete already exist, so shared-league
  cleanup does not need to wait on new contest/entry delete features.
- Root-admin delete-any-user is not a blocker for this lane. Reusable fixture
  users should greatly reduce the need for manual user cleanup; add a separate
  follow-up only if residue still proves operationally painful after the shared
  fixture strategy lands.

## Locked Decisions

1. Browser E2E should stop creating new durable QA users and leagues on every
   run.
2. The primary deployed browser fixture should be one reusable
   `QA-TEST-LEAGUE`.
3. Browser tests may repair prerequisite state if it is missing:
   - log in with stable commissioner/member QA accounts
   - create `QA-TEST-LEAGUE` only if it does not exist
   - restore expected member access only if it is missing
4. Local test hygiene should be improved in the local harness, not deferred to
   manual database cleanup.
5. Manual QA cleanup should prefer real product/admin lifecycle flows over
   ad hoc SQL whenever those flows already exist.

## Desired End State

- CI browser E2E uses stable QA fixture accounts plus one self-healing shared
  QA league.
- The shared QA league can host high-value commissioner/member flows without
  unbounded growth of leagues, contests, entries, and invitations.
- Local `poolmaster_test` runs have an authoritative cleanup/reset path and do
  not depend on heuristic leftovers disappearing by chance.
- Existing delete flows become part of real QA operations and therefore get
  truthful manual regression usage.

## Execution Direction

### 1. Reusable QA Browser Fixtures

- Extend the QA fixture-user bootstrap to include stable commissioner and member
  browser accounts in addition to the root-admin fixture.
- Replace per-run random Playwright identities with login-first helpers that
  use those stable accounts.
- Introduce a self-healing shared-league helper:
  - locate `QA-TEST-LEAGUE`
  - create it through real UI/API flows if absent
  - verify commissioner ownership and member membership
- Keep browser journeys focused on high-value workflows:
  - commissioner login
  - member login
  - commissioner contest creation
  - member contest entry creation/update

### 2. Shared-League Artifact Control

- Do not let the shared league become the new clutter source.
- Reuse or clean up subordinate artifacts inside the shared league:
  - delete/replace draft contests with deterministic E2E names
  - delete/recreate the member entry when the flow requires a fresh state
  - prefer idempotent "prepare fixture state" helpers before each spec over
    permanently accumulating one-off contest rows
- If a truthful cleanup flow does not exist for some subordinate object, keep
  the browser scope away from that object until an ownership/cleanup story is
  added.

### 3. Local Backend Test Hygiene

- Harden functional cleanup so it no longer depends only on user email prefixes
  and happy-path `afterAll` execution.
- Harden integration cleanup so it no longer relies on narrow name patterns or
  partial provider-id assumptions.
- Treat `poolmaster_test` as disposable and document the supported reset flow
  when residue remains after an interrupted run.
- Prefer one authoritative reset/cleanup entry point for local DB-backed
  testing so developers can recover quickly when the local database gets dirty.

### 4. Manual QA Cleanup Operations

- Use existing league delete with cascade cleanup as the main manual tool for
  occasional QA league reset.
- Keep reusable fixture users durable by default; use self-account
  inactivate/delete only for occasional test-user reset, not as the normal
  browser cleanup strategy.
- After the shared-fixture browser lane lands, remove existing QA residue using
  the real lifecycle flows where practical.
- If old QA residue still requires deleting arbitrary dormant users as a
  root-admin operation, create a separate follow-up lane rather than expanding
  this plan mid-slice.

## Acceptance Criteria

- Browser E2E no longer creates unbounded new QA users and leagues on every
  deploy-gate run.
- Shared QA browser fixtures are self-healing enough that a missing league can
  be recreated truthfully without manual pre-seeding.
- Local functional/integration runs leave the test DB clean enough for repeated
  developer use, with a documented reset path for interrupted runs.
- Manual QA cleanup can be performed through existing real lifecycle flows
  rather than bespoke SQL for normal operation.

