## Objective

Stabilize the current browser E2E lane immediately by reducing it to the minimum
truthful proof until real lifecycle cleanup exists.

## Why This Exists

The current browser suite creates durable QA data and has no real cleanup path
yet. Until league lifecycle and account lifecycle features exist, we should not
keep broader browser journeys active in the deploy gate.

## Immediate Direction

- keep only one browser E2E script
- reduce it to the minimum stable proof:
  - sign up or log in
  - assert landing on `/welcome`
- remove the stale multi-flow scripts from CI scope for now

## Future Direction

After [83-league-lifecycle-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/83-league-lifecycle-execution.md)
and [85-user-account-lifecycle-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/85-user-account-lifecycle-execution.md)
land, expand the single commissioner journey again.

## QA Backlog Cleanup

- Existing QA seed/test data should be removed after the lifecycle APIs/flows
  exist.
- Prefer the real APIs and user flows for that cleanup.
- Keep
  [code-review/008-qa-cleanup.sql](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/code-review/008-qa-cleanup.sql)
  only as a one-time bridge if needed after correction to current schema.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 86-001 | 1 | Frontend developer: reduce browser E2E to one minimal deploy-gate script | Done | `clients/poolmaster/e2e/authenticated-landing.e2e.ts` now keeps only a real sign-up → `/welcome` assertion. |
| 86-002 | 1 | Frontend developer: remove stale broader E2E flows from current CI scope | Done | Removed the invite, multi-league, and create-league browser journeys from the active deploy-gate script until cleanup lifecycle exists. |
| 86-003 | 1 | Update CI/testing plan references to the temporary minimum E2E lane | Done | The active E2E reset plan and testing/workflow rules now explicitly describe the temporary minimum deploy-gate lane and the longer-term commissioner/member lifecycle strategy. |
| 86-004 | 2 | After league lifecycle lands, expand the commissioner journey again | Not Started | Create league → future commissioner flows → delete league |
| 86-005 | 2 | After account lifecycle lands, add self-delete cleanup to the browser journey | Not Started | Member then commissioner account cleanup |
| 86-006 | 2 | Remove existing QA residue after lifecycle flows exist | Not Started | Prefer API/user-flow cleanup, SQL only if still needed |
