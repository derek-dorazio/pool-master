# Plan 35: Active Coverage Execution

> **Planning Note (2026-04-04):** This plan takes over the remaining execution work from [plans/34-worker-sliced-stability-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/34-worker-sliced-stability-execution.md) now that the first worker wave has landed. Keep this plan focused on active MVP coverage growth, defects revealed by that work, and justified DB-backed integration additions.

## Purpose

Track the remaining fast-suite defect-discovery work in one place, without mixing it into broader platform cleanup or the already-mostly-complete initial worker-slice plan.

This plan exists to:

- keep the remaining `SHD-006` work concrete and execution-ready
- track the current worker lanes and the next queued slices
- separate coverage execution from platform hardening and anti-pattern audit work
- make it clear when a slice should add DB-backed integration coverage versus only Jest/Vitest coverage

## Relationship To Other Plans

- [plans/33-stability-hardening-and-defect-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/33-stability-hardening-and-defect-discovery.md) remains the high-level stabilization umbrella.
- [plans/34-worker-sliced-stability-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/34-worker-sliced-stability-execution.md) is now the historical record of the first worker wave.
- [plans/testing/coverage-threshold-ratchet.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/coverage-threshold-ratchet.md) remains the source of truth for threshold numbers and ratchet policy.

## Slice Selection Rules

- Prefer `Vitest` for active web/admin component, page, and hook behavior.
- Prefer backend `Jest` for service, mapper, and permission logic.
- Add DB-backed integration only when the real HTTP/service/database boundary materially increases confidence:
  - permission and ownership checks
  - persisted state transitions
  - route validation and request-shape behavior
  - multi-record CRUD/read-after-write flows
- Do not add slow smoke or browser E2E coverage from this plan.

## Worker Constraints

- Keep one plan slice per commit unless the main thread explicitly approves bundling.
- Do not change coverage thresholds from a worker slice.
- Do not mark unrelated slice rows `In Progress` or `Done`.
- If a slice uncovers adjacent work, report it separately instead of bundling it into the same commit.
- Tests must prove the claimed behavior, especially for role, permission, and ownership scenarios.

## Current Active Slices

### Slice A: Contest Entry, Results, Standings, and Scoring Review

**Goal**

Raise confidence in the post-create contest review path, especially the seams between contest detail, standings, scoring, and results.

**Primary Files**

- [clients/web/src/pages/contests/detail.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/detail.tsx)
- [clients/web/src/pages/contests/detail.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/detail.test.tsx)
- [clients/web/src/pages/contests/results.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/results.tsx)
- [clients/web/src/pages/contests/results.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/results.test.tsx)
- [clients/web/src/pages/contests/scoring.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/scoring.tsx)
- [clients/web/src/pages/contests/scoring.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/scoring.test.tsx)
- [clients/web/src/pages/contests/standings.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/standings.tsx)
- [clients/web/src/pages/contests/standings.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/standings.test.tsx)

**Expected Test Type**

- `Vitest`

### Slice B: Backend Invitation and Membership Permissions

**Goal**

Tighten backend confidence in invitation, membership, and permission behavior where the real persisted route boundary matters.

**Primary Files**

- [tests/unit/core-api/invitation-service.test.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/unit/core-api/invitation-service.test.ts)
- [tests/unit/core-api/league-permissions.test.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/unit/core-api/league-permissions.test.ts)
- [tests/integration/core-api/member-invitation-crud.integration.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/integration/core-api/member-invitation-crud.integration.ts)
- [tests/integration/core-api/permission-negative.integration.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/integration/core-api/permission-negative.integration.ts)

**Expected Test Types**

- backend `Jest`
- DB-backed integration where permission and request-shape behavior need real validation

### Slice C: Web Settings, Profile, and Account Management

**Goal**

Strengthen the active account-management path: profile edits, password changes, and linked accounts.

**Primary Files**

- [clients/web/src/features/settings/profile-form.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/profile-form.tsx)
- [clients/web/src/features/settings/profile-form.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/profile-form.test.tsx)
- [clients/web/src/features/settings/password-change-form.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/password-change-form.tsx)
- [clients/web/src/features/settings/password-change-form.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/password-change-form.test.tsx)
- [clients/web/src/features/settings/linked-accounts.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/linked-accounts.tsx)
- [clients/web/src/features/settings/linked-accounts.test.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/linked-accounts.test.tsx)

**Expected Test Type**

- `Vitest`

### Slice D: Admin Audit and Announcements

**Goal**

Strengthen confidence in the active admin audit and announcement workflows, including list, expand, activate/deactivate, and create behavior.

**Primary Files**

- [clients/admin/src/pages/audit/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/audit/index.tsx)
- [clients/admin/src/pages/announcements/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/announcements/index.tsx)
- [clients/admin/src/pages/announcements/create.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/announcements/create.tsx)

**Expected Test Type**

- admin `Vitest`

### Slice E: Backend Dashboard and Social Read Edges

**Goal**

Increase confidence in active dashboard and social read behavior where unit and targeted DB-backed integration tests can expose real backend defects.

**Primary Files**

- [tests/unit/core-api/dashboard-service.test.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/unit/core-api/dashboard-service.test.ts)
- [tests/unit/core-api/social-communication-service.test.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/unit/core-api/social-communication-service.test.ts)
- [tests/integration/core-api/history-read.integration.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/integration/core-api/history-read.integration.ts)
- [tests/integration/core-api/social-feed-read.integration.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/integration/core-api/social-feed-read.integration.ts)

**Expected Test Types**

- backend `Jest`
- targeted DB-backed integration only if the persisted read-model behavior is the actual risk

## Next Queue

These are the next three candidate slices after the current active set lands:

1. League feed/history/recap coverage on active league surfaces
2. Settings compliance/account-deletion and data-export UI coverage
3. Admin provider/tenant detail active-surface coverage

## Action Plan

| ID | Slice | Task | Status | Notes |
|---|---|---|---|---|
| ACE-001 | A | Expand contest entry/results/standings/scoring review coverage | In Progress | Currently in flight on the contest review worker lane |
| ACE-002 | B | Expand backend invite and membership permission coverage | In Progress | Currently in flight on the backend invite/permissions worker lane |
| ACE-003 | C | Expand web settings/profile/account-management coverage | In Progress | First worker commit landed locally as `79fddf7`; integrate after the current worker batch is reconciled |
| ACE-004 | D | Expand admin audit and announcements coverage | In Progress | Currently in flight on the admin audit/announcements worker lane |
| ACE-005 | E | Expand backend dashboard/social edge coverage | In Progress | Currently in flight on the backend dashboard/social worker lane |
| ACE-006 | Queue | League feed/history/recap coverage | In Progress | External worker produced a mixed-scope commit; salvage only the league feed/history/recap files and strengthen commissioner-behavior assertions before marking done |
| ACE-007 | Queue | Settings compliance/account deletion/data export coverage | In Progress | External worker found a valid generated-SDK cleanup in `useDataExportStatus`, but it landed inside the mixed ACE-006 commit and needs to be separated cleanly |
| ACE-008 | Queue | Admin provider/tenant detail coverage | In Progress | External worker found valid provider/tenant error-state fixes and tests, but the slice also changed admin coverage thresholds; salvage the slice without the threshold ratchet before marking done |

## Acceptance Criteria

- Remaining active-MVP coverage work is tracked outside the broad stability umbrella.
- Each active slice has a clear expected test type and write scope.
- DB-backed integration additions are deliberate and justified by backend-boundary risk.
- Coverage growth continues in worker-safe slices without colliding with Plan 30 hardening work.
