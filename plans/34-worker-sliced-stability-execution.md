# Plan 34: Worker-Sliced Stability Execution

> **Planning Note (2026-04-04):** Re-analyze current CI health, active MVP scope, and the latest enforced coverage baselines before executing any slice below. This plan is an execution split for the current stability phase, not a permanent ownership map.

## Purpose

Break the current hardening phase into bounded, low-conflict slices that can be assigned to separate workers after the main thread confirms the repo is stable enough for parallel work.

This plan exists to:

- separate high-signal hardening work into disjoint ownership areas
- reduce merge conflicts while the main branch remains under active stabilization
- keep the main thread focused on shared architecture and CI/CD risk
- let secondary workers expand fast-suite coverage and expose defects in parallel

## Relationship To Other Plans

This plan is the worker-execution companion to:

- [plans/33-stability-hardening-and-defect-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/33-stability-hardening-and-defect-discovery.md)
- [plans/testing/coverage-threshold-ratchet.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/coverage-threshold-ratchet.md)
- [plans/30-platform-and-deploy-hardening.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/30-platform-and-deploy-hardening.md)

Use Plan 33 for the high-level stabilization goals and this plan for concrete worker delegation.

## Parallelization Rules

- Keep the **main thread** on shared CI, package, architecture, and cross-slice contract work.
- Assign workers only to slices with a clearly disjoint write set.
- Do not let workers modify:
  - `.github/workflows/ci.yml`
  - shared package exports
  - OpenAPI generation scripts
  - Prisma schema or migrations
  - core shared testing rules
  unless that worker is explicitly the owner of that slice.
- If a slice reveals a shared-contract problem, stop and hand that issue back to the main thread instead of patching around it locally.

## Main Thread Responsibilities

The main thread should keep ownership of:

- CI/CD hardening and deploy maturity
- shared package/runtime cleanup
- coverage policy and threshold changes
- shared test-helper patterns
- decisions about deleting or deferring suites
- plan/rules/doc updates that affect the whole repo

## Worker Slices

### Slice A: Web Auth Coverage

**Goal**

Raise confidence in the active auth pages and expose defects in the login/register flows without touching deploy-gate browser tests.

**Primary Files**

- [clients/web/src/pages/auth/login.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/auth/login.tsx)
- [clients/web/src/pages/auth/register.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/auth/register.tsx)
- nearby auth tests under `clients/web/src/pages/auth/*.test.*` or `clients/web/src/features/auth/**`

**Allowed Work**

- add or improve Vitest coverage
- add stable form/test selectors if missing
- fix real auth-form defects revealed by tests

**Do Not Touch**

- browser smoke/E2E files
- shared auth-store behavior unless the main thread delegates it explicitly

### Slice B: League Detail and Membership Coverage

**Goal**

Strengthen coverage around the core league experience, especially detail, members, feed/history tabs, and settings seams that remain in the MVP.

**Primary Files**

- [clients/web/src/pages/leagues/detail.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/leagues/detail.tsx)
- [clients/web/src/pages/leagues/members.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/leagues/members.tsx)
- [clients/web/src/pages/leagues/settings.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/leagues/settings.tsx)
- related hooks/components in `clients/web/src/features/social` and `clients/web/src/features/dashboard` only if directly needed

**Allowed Work**

- add or improve Vitest coverage for league detail/settings/member flows
- fix real UI contract issues revealed by those tests

**Do Not Touch**

- contest creation
- draft room
- generated SDK files

### Slice C: Contest Review Surface Coverage

**Goal**

Improve confidence in active contest detail, standings, scoring, and results pages for the narrowed MVP modes.

**Primary Files**

- [clients/web/src/pages/contests/detail.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/detail.tsx)
- [clients/web/src/pages/contests/standings.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/standings.tsx)
- [clients/web/src/pages/contests/scoring.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/scoring.tsx)
- [clients/web/src/pages/contests/results.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/contests/results.tsx)

**Allowed Work**

- add or improve Vitest coverage
- remove local casts and shape-normalization anti-patterns surfaced by tests
- fix real mode-aware display defects

**Do Not Touch**

- deferred contest families
- create flow
- draft engine internals

### Slice D: Draft Room Coverage

**Goal**

Increase confidence in the draft room page and active contestant-selection UX for the kept MVP modes.

**Primary Files**

- [clients/web/src/pages/drafts/room.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/drafts/room.tsx)
- [clients/web/src/features/draft-room/available-panel.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/draft-room/available-panel.tsx)
- [clients/web/src/features/draft-room/selection-overview.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/draft-room/selection-overview.tsx)
- [clients/web/src/features/draft-room/draft-header.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/draft-room/draft-header.tsx)

**Allowed Work**

- add or improve Vitest coverage
- fix room-state display defects
- remove fantasy-specific wording regressions if any remain

**Do Not Touch**

- backend draft engine contracts
- contest create flow

### Slice E: Backend Contest and Scoring Edge Coverage

**Goal**

Increase backend Jest and DB-backed integration confidence in active contest validation, scoring consumer seams, and mapper/service edges that support the current MVP.

**Primary Files**

- contest/scoring files under `packages/core-api/src/modules/contests/**`
- scoring consumer/read-model files under `packages/core-api/src/modules/scoring/**`
- targeted suites under `tests/unit/core-api/**` and `tests/integration/core-api/**`

**Allowed Work**

- add focused Jest coverage
- add focused DB-backed integration coverage
- fix real validation/mapper/scoring defects revealed by tests

**Do Not Touch**

- Prisma schema or migrations
- shared DTO exports
- CI workflow files

### Slice F: Admin Coverage on Active Surfaces

**Goal**

Improve confidence in the still-supported admin surfaces without broadening admin scope.

**Primary Files**

- [clients/admin/src/pages/home.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/home.tsx)
- [clients/admin/src/pages/health/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/health/index.tsx)
- [clients/admin/src/pages/config/platform.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/config/platform.tsx)
- [clients/admin/src/pages/config/notifications.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/config/notifications.tsx)

**Allowed Work**

- add or improve admin Vitest coverage
- fix real UI/API contract issues

**Do Not Touch**

- deferred admin feature families
- backend route contracts without main-thread approval

## Suggested Execution Order

1. Main thread: continue shared hardening, coverage policy, and stale-architecture cleanup.
2. Worker A: auth coverage.
3. Worker B: league detail/membership coverage.
4. Worker C: contest review surface coverage.
5. Worker D: draft room coverage.
6. Worker E: backend contest/scoring edge coverage.
7. Worker F: admin active-surface coverage.
8. Main thread: integrate, remeasure baselines, and decide whether any threshold ratchet is justified.

## Merge Strategy

- Prefer one worker per slice, one commit per slice.
- Re-run the fast local gate set after integrating each slice.
- Do not raise coverage thresholds mid-slice.
- If multiple slices land in one day, update the coverage plan only once after the combined baseline is remeasured.

## Action Plan

| ID | Slice | Task | Status | Notes |
|---|---|---|---|---|
| WSH-001 | Main | Keep shared CI/CD, package/runtime, and policy hardening on the main thread | In Progress | Do not delegate shared-contract work while the repo is still tightening stability gates |
| WSH-002 | A | Add focused web auth coverage and fix defects revealed there | Not Started | Candidate first worker once the next CI cycle is calm |
| WSH-003 | B | Add league detail/member/settings coverage and fix defects revealed there | Not Started | Good parallel slice with mostly disjoint files |
| WSH-004 | C | Add contest review surface coverage for active MVP modes | Not Started | Keep deferred modes out of scope |
| WSH-005 | D | Add draft-room coverage for kept MVP modes | Not Started | Separate from contest create flow to reduce conflict |
| WSH-006 | E | Add backend contest/scoring edge coverage and targeted DB integration cases | Not Started | Main thread should review any shared-contract changes carefully |
| WSH-007 | F | Add admin coverage only on still-supported active surfaces | Not Started | Avoid reviving deferred admin depth |
| WSH-008 | Main | Re-measure coverage and decide whether ratchet changes are justified after worker slices land | Not Started | Update [coverage-threshold-ratchet.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/coverage-threshold-ratchet.md) only after merged changes are stable |

## Acceptance Criteria

- The hardening phase is decomposed into clear slices with disjoint ownership.
- The main thread retains all shared-risk work.
- Workers can increase coverage and expose defects without colliding on the same files.
- Coverage gains are integrated intentionally rather than through ad hoc overlapping edits.
