# Plan 34: Worker-Sliced Stability Execution

> **Planning Note (2026-04-04):** Re-analyze current CI health, active MVP scope, and the latest enforced coverage baselines before executing any slice below. This plan is an execution split for the first stability wave, not a permanent ownership map. Remaining active execution now continues in [plans/35-active-coverage-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/35-active-coverage-execution.md).

## Purpose

Break the current hardening phase into bounded, low-conflict slices that can be assigned to separate workers after the main thread confirms the repo is stable enough for parallel work.

This plan exists to:

- separate high-signal hardening work into disjoint ownership areas
- reduce merge conflicts while the main branch remains under active stabilization
- keep the main thread focused on shared architecture and CI/CD risk
- let secondary workers expand fast-suite coverage and expose defects in parallel

## Relationship To Other Plans

This plan is the worker-execution companion to:

- [plans/archive/33-stability-hardening-and-defect-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/33-stability-hardening-and-defect-discovery.md)
- [plans/testing/coverage-threshold-ratchet.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/testing/coverage-threshold-ratchet.md)
- [plans/30-platform-and-deploy-hardening.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/30-platform-and-deploy-hardening.md)

Use archived Plan 33 only for historical context and this plan for the concrete delegated execution record from that wave.

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

### Slice G: Web Settings and Profile Coverage

**Goal**

Strengthen the active settings/profile/account-management surfaces that remain part of the MVP, especially profile edits, password changes, and linked-account flows.

**Primary Files**

- [clients/web/src/pages/settings/profile.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/pages/settings/profile.tsx)
- [clients/web/src/features/settings/profile-form.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/profile-form.tsx)
- [clients/web/src/features/settings/password-change-form.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/password-change-form.tsx)
- [clients/web/src/features/settings/linked-accounts.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/web/src/features/settings/linked-accounts.tsx)

**Allowed Work**

- add or improve Vitest coverage
- fix real settings/profile/account-management defects revealed by those tests

**Do Not Touch**

- contest review pages
- draft room pages
- shared DTO exports
- generated SDK files

### Slice H: Admin Audit and Announcements Coverage

**Goal**

Strengthen confidence in the active admin audit and announcement workflows, including list, expand, activate/deactivate, and create behavior.

**Primary Files**

- [clients/admin/src/pages/audit/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/audit/index.tsx)
- [clients/admin/src/pages/announcements/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/announcements/index.tsx)
- [clients/admin/src/pages/announcements/create.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/admin/src/pages/announcements/create.tsx)

**Allowed Work**

- add or improve admin Vitest coverage
- add stable selectors where the admin UI needs them
- fix real UI/API contract issues revealed by tests

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
8. Worker G: web settings/profile coverage.
9. Worker H: admin audit and announcements coverage.
10. Main thread: integrate, remeasure baselines, and decide whether any threshold ratchet is justified.

## Merge Strategy

- Prefer one worker per slice, one commit per slice.
- Re-run the fast local gate set after integrating each slice.
- Do not raise coverage thresholds mid-slice.
- If multiple slices land in one day, update the coverage plan only once after the combined baseline is remeasured.

## Action Plan

| ID | Slice | Task | Status | Notes |
|---|---|---|---|---|
| WSH-001 | Main | Keep shared CI/CD, package/runtime, and policy hardening on the main thread | In Progress | Do not delegate shared-contract work while the repo is still tightening stability gates |
| WSH-002 | A | Add focused web auth coverage and fix defects revealed there | Done | Main thread pilot slice completed on 2026-04-04. Added meaningful auth page coverage for submit success/failure, redirect preservation, wizard progression, and age validation without surfacing deeper shared-architecture issues. |
| WSH-003 | B | Add league detail/member/settings coverage and fix defects revealed there | Done | Added MSW-backed Vitest coverage for league detail, members, and settings; switched those surfaces to generated SDK calls where they had drifted to manual client usage; added stable selectors and honest loading states for the active MVP seams. A later worker follow-up added commissioner invite-send coverage on the members page and stabilized the related admin/settings tests under the full suite load. |
| WSH-004 | C | Add contest review surface coverage for active MVP modes | Done | Worker slice completed on 2026-04-04. Added focused review-surface coverage, fixed the scoring-page selected-entry reset when the contest changes, and tightened singular/plural label handling across active contest review pages. |
| WSH-005 | D | Add draft-room coverage for kept MVP modes | Done | Main-thread draft-room slice completed on 2026-04-04. Added room action wiring coverage for turn-based picks, participant drawer selection, pick'em picks/confidence, and bracket actions without surfacing deeper shared-architecture issues. A later worker follow-up added real-entry hook coverage for participant mapping, sort behavior, and simple-vs-extended pick payload routing. |
| WSH-006 | E | Add backend contest/scoring edge coverage and targeted DB integration cases | Done | Added scoring-consumer dedupe coverage, active-contest filtering coverage, and contest/scoring unit edge tests without touching shared DTO or schema surfaces |
| WSH-007 | F | Add admin coverage only on still-supported active surfaces | Done | Added focused Vitest coverage for home, health, and config surfaces; fixed the notification template update payload to send `emailText` for the edited email body. |
| WSH-008 | Main | Re-measure coverage and decide whether ratchet changes are justified after worker slices land | Done | The merged worker wave passed the full local gate on 2026-04-04, exposed no new shared-architecture problems, and justified a second threshold ratchet. After the follow-up CI regression fixes and worker additions, the latest validated local baselines are 24.00 / 14.20 / 21.15 / 24.53 (backend), 57.33 / 48.65 / 56.79 / 60.24 (web), and 26.96 / 21.55 / 20.75 / 28.33 (admin). |
| WSH-009 | G | Add web settings/profile coverage and fix defects revealed there | In Progress | This remaining execution slice now lives in [plans/35-active-coverage-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/35-active-coverage-execution.md). The first worker commit expanded settings/profile component coverage and remeasured the improved baselines; final integration happens in the active plan. |
| WSH-010 | H | Add admin audit and announcements coverage on active surfaces | In Progress | This remaining execution slice now lives in [plans/35-active-coverage-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/35-active-coverage-execution.md). Use that plan for ongoing audit/announcement coverage work and any follow-on admin slice decomposition. |

## Acceptance Criteria

- The hardening phase is decomposed into clear slices with disjoint ownership.
- The main thread retains all shared-risk work.
- Workers can increase coverage and expose defects without colliding on the same files.
- Coverage gains are integrated intentionally rather than through ad hoc overlapping edits.
