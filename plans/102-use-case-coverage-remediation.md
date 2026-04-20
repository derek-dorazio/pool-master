# Plan 102: Use-Case Coverage Remediation

## Purpose

Repair the gap between documented product use cases and the automated tests that
are supposed to prove those behaviors actually work.

This plan is not about chasing percentage coverage alone. It is about making
the automated suite truthful enough that:

- positive use cases are proven
- negative/error/permission use cases are proven
- failing tests create immediate, actionable defects
- released behavior is not treated as complete while still broken through the
  stack

## Trigger For This Plan

The current repo has repeatedly allowed broken or half-implemented behavior to
reach deployment while the automated story remained incomplete or misleading.

Recent concrete examples:

- the startup ingestion scheduler existed in code, but there was no automated
  proof that it produced contest-ready event field data
- richer browser contest journeys were drafted without deterministic event data
  or a truthful provisioning contract
- contest creation and participation flows were implemented in slices without a
  stable automated proof of the imported-event -> managed contest -> entry
  workflow
- root-admin operational event-sync behavior existed partially in backend/UI
  surfaces without functional use-case coverage proving the end-to-end admin
  flow

## Current Audit Findings

### A. Browser E2E Coverage Is Still Smoke-Only

Current deployed browser suite:

- [clients/poolmaster/e2e/authenticated-landing.e2e.ts](/Users/DDorazio/development/Github-Personal/pool-master/clients/poolmaster/e2e/authenticated-landing.e2e.ts)
- [clients/poolmaster/e2e/commissioner-league-setup.e2e.ts](/Users/DDorazio/development/Github-Personal/pool-master/clients/poolmaster/e2e/commissioner-league-setup.e2e.ts)
- [clients/poolmaster/e2e/member-league-invite-acceptance.e2e.ts](/Users/DDorazio/development/Github-Personal/pool-master/clients/poolmaster/e2e/member-league-invite-acceptance.e2e.ts)

What is missing:

- commissioner creates contest from imported event
- member creates entry for supported tiered golf contest
- locked-entry read-only workflow
- live leaderboard / final standings workflow
- root-admin operational sync workflow

### B. Root-Admin Functional Coverage Is Too Narrow

Current root-admin functional suite:

- [tests/functional/root-admin.functional.ts](/Users/DDorazio/development/Github-Personal/pool-master/tests/functional/root-admin.functional.ts)

What it currently proves:

- root-admin permission gate on user-management reads
- happy-path user detail reads

What is missing:

- root-admin provider health visibility
- sync-run history visibility
- manual sport sync trigger
- event re-ingest operational flow
- negative permission/error cases for the operational routes

### C. Contest Functional Coverage Misses The Imported-Event Managed Flow

Current contest functional suite:

- [tests/functional/contests.functional.ts](/Users/DDorazio/development/Github-Personal/pool-master/tests/functional/contests.functional.ts)

What it currently proves well:

- legacy contest CRUD and entry lifecycle
- entry rename/update/lock validation at the API layer

What is missing:

- provider-imported event -> managed contest creation
- template-first create flow
- contest-eligible event readiness as a prerequisite to managed creation
- contest field readiness driven by imported event field/source data

This means the current contest FAPI suite does not actually prove the golf-first
product path we have been building.

### D. Scheduler / Ingestion Readiness Has No Truthful Proof

Current code reality:

- scheduler starts on app readiness unless `AUTO_START_SCHEDULER=false`
- startup only guarantees shallow schedule/participant/ranking jobs are kicked
  off
- startup does **not** guarantee event-detail ingestion has populated
  `SportEventParticipant` and source data needed for contest-ready workflows

Missing proof:

- no automated test that startup ingestion yields contest-ready imported event
  data
- no automated test that manual operational sync + re-ingest yields
  contest-ready data

### E. History / Results Functional Coverage Still Depends On Seeded Fixture Paths

Current history functional suite:

- [tests/functional/standings-history-consent.functional.ts](/Users/DDorazio/development/Github-Personal/pool-master/tests/functional/standings-history-consent.functional.ts)

What is missing:

- completed contest history reached through the imported-event / managed-contest
  flow
- proof that the same production pipeline used by commissioners/members yields
  completed history data without direct fixture-only shortcuts

## Remediation Principles

1. Do not accept percentage coverage as a substitute for use-case coverage.
2. Every released positive and negative use case must be mapped to an automated
   proof layer.
3. If a use case cannot yet be proven because environment/data setup is missing,
   log that as a real gap rather than pretending the feature is already proven.
4. Failing tests are defects until proven otherwise.
5. Do not reintroduce brittle browser journeys into required CI until their
   data/setup contract is truthful and repeatable.

## Remediation Lanes

### Lane 1: Coverage Matrix And Traceability

- create a durable use-case-to-test matrix for the active MVP lanes
- map each documented positive and negative use case to its proving layers:
  - unit
  - data integration
  - contract verification
  - functional API
  - browser E2E
- flag missing proofs explicitly

### Lane 2: Root-Admin Operational Proofs

- add functional API coverage for:
  - root-admin sync-run visibility
  - manual sport sync trigger
  - event re-ingest behavior
  - forbidden non-root-admin access
- decide whether event re-ingest is required for “contest-ready” proof or if a
  deeper sport sync path must be implemented first

### Lane 3: Contest Flow Functional Proofs

- add truthful FAPI coverage for:
  - imported event exists
  - commissioner creates managed contest from eligible event/template
  - contest is immediately entry-ready
  - member/team creates entry
  - entry update/lock behavior uses the imported event-backed field

### Lane 4: Ingestion Readiness Proofs

- add targeted integration/functional proof for the real readiness contract:
  - startup scheduler behavior
  - shallow schedule sync vs full event detail ingestion
  - manual sync/re-ingest path to contest-ready event field data
- if the current product path cannot produce contest-ready data deterministically,
  log and fix that architecture gap before claiming the workflow is covered

### Lane 5: Browser E2E Rebuild On Truthful Data `(Deferred)`

- keep deploy-gate browser smoke minimal until lower-layer proof and
  deterministic data/setup are both real
- do not expand richer browser E2E while local and CI lower-layer suites are
  still missing the same workflow proof
- revisit only after the non-E2E remediation lanes are substantially complete

## Acceptance Criteria

- active MVP use cases have an explicit automated coverage mapping
- major missing proofs are tracked and prioritized
- root-admin event sync/re-ingest has truthful automated proof
- imported-event managed contest flow has truthful automated proof
- release confidence is based on real use-case proof, not just broad coverage
  percentages

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 102-001 | 1 | Create the active MVP use-case-to-test coverage matrix | Not Started | This is the durable map Tess and Quinn should maintain |
| 102-002 | 2 | Add root-admin functional coverage for sync history, manual sport sync, and re-ingest flows | Not Started | Current root-admin FAPI only covers user-management reads |
| 102-003 | 3 | Add managed contest functional coverage for imported-event -> contest -> entry-ready workflow | Not Started | Current contest FAPI is still centered on legacy `createContest` paths |
| 102-004 | 4 | Add truthful readiness tests for scheduler/manual sync/re-ingest contest-ready data behavior | Not Started | This is the current hidden architecture/testing gap |
| ~~102-005~~ | 5 | ~~Redefine richer browser E2E around deterministic setup and only reintroduce supported journeys~~ | Removed | Deferred until lower-layer use-case proof is stable; browser smoke stays minimal for now |
| 102-006 | 5 | Log and fix every defect exposed by the new automated coverage before treating the slice as deployable | Not Started | Tests are supposed to create immediate defect pressure, not passive TODOs |
