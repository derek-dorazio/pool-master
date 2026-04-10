## Objective

Adopt a new **functional API test suite** as a first-class backend quality gate for local development and CI.

This suite should exercise the full service stack through the generated SDK and real HTTP transport against a locally started Fastify server and real Postgres database.

The suite is intended to become the primary pre-merge/pre-publish confidence layer for:

- CRUD behavior
- documented use-case API workflows
- authorization and permission behavior
- business rules and lifecycle constraints
- error-envelope and contract behavior
- end-to-end service-stack integrity through the generated SDK

This plan is the adoption and coordination companion to Plan 64.

- Use Plan 64 as the canonical execution tracker for framework and per-domain implementation slices.
- Use this plan to track rollout decisions, dependencies, rule ownership, CI adoption, and downstream suite retirement.

## Review Outcome For Plan 64

The direction in archived [plans/archive/2026-04-service-and-frontend-baseline/64-sdk-functional-test-suite.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/2026-04-service-and-frontend-baseline/64-sdk-functional-test-suite.md) is strong and should be adopted with these clarifications:

- Treat this as a **functional API suite**, not just contract testing.
- Keep the focus on **CRUD, use-case journeys, and backend business logic**.
- Use the generated SDK as the public interface, but verify real persisted outcomes too.
- This suite should **replace most of the current smoke-test behavior** as a build/merge gate.
- It should be part of **local validation and CI**, with merged coverage reporting.
- It should not depend on deployed infrastructure.

## Scope

### In Scope

- new `tests/functional/` suite
- Fastify `listen()` test harness using localhost and real HTTP
- generated SDK client setup for authenticated and unauthenticated flows
- builders/helpers for repeated object-graph setup where reuse is clear
- CRUD coverage for active backend domain objects
- use-case journeys aligned with the active plan companions
- authorization, validation, not-found, and conflict-path testing
- structured error-envelope assertions
- merged coverage integration with the existing service coverage reporting
- local and CI execution wiring
- worker-safe per-domain suite expansion on the live service model only

### Out of Scope

- deployed-environment smoke journeys
- browser-driven user flows
- web/admin rebuild work
- historical tenant/admin-user model assumptions
- archived web/admin client behavior

## Required Test Coverage Categories

The functional API suite should cover, at minimum:

1. **CRUD**
- leagues
- squads
- memberships/invitations where applicable
- contests and contest configuration
- entries
- roster picks
- draft sessions/history where active
- consent records

2. **Use-Case API Journeys**
- league creation and invitation acceptance
- squad creation and co-manager lifecycle
- commissioner contest creation and configuration
- member entry creation and roster selection
- draft lifecycle for active selection modes
- scoring recalculation and standings reads
- completed-contest history reads

3. **Business Rules**
- one squad per user per league
- contest edit restrictions after lock
- entry numbering
- roster uniqueness/selection validation
- permission boundaries by member/commissioner/root-admin capability
- cookie-session and CSRF behavior for browser-authenticated flows

4. **Error Behavior**
- validation failures
- unauthenticated access
- unauthorized/forbidden access
- resource not found
- conflict/duplicate scenarios
- shared error-envelope assertions for routes that have migrated

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Finalize the functional-suite naming and scope | Service-facing scripts, coverage directories, CI jobs, artifact names, and docs now use the `service-*` / `poolmaster-*` naming consistently. |
| Done | Adopt Plan 64 Slice 64-A as the required pilot gate | Functional harness, pilot auth/consent coverage, CI wiring, renamed service coverage surfaces, and child-process coverage attribution are all in place and green |
| Pending | Execute the domain coverage slices from Plan 64 | Track implementation progress in Plan 64 task rows rather than duplicating per-domain slice rows here |
| Done | Integrate functional suite into local build/test flow | Root scripts now expose `test:service:functional-api` and `test:coverage:service:merged`, and active setup docs use those names. |
| Done | Integrate functional suite into CI | CI now reports `service-coverage-report` and `poolmaster-unit-tests` with the renamed service coverage buckets and artifacts. |
| Done | Own cross-rule/docs updates for the new test strategy | Updated workflow/testing rules, AGENTS, README, developer setup, and Plan 64 naming references. |
| Pending | Define and execute redundant-test pruning after coverage is in place | Remove integration/contract tests only when the functional suite clearly replaces their signal |

## Worker-Safe Rollout Slices

Use only the live post-refactor model and contracts when expanding coverage:

1. `auth-and-session`
- registration, login, refresh, logout, `/auth/me`
- cookie-session behavior
- CSRF enforcement
- root-admin cookie-session parity

2. `leagues-and-invitations`
- league create/list/detail
- commissioner invitation send/generate/revoke
- invitation acceptance and membership lifecycle

3. `squads-and-memberships`
- squad CRUD
- co-manager/member lifecycle where active
- one-squad-per-user and membership constraints

4. `contests-and-entries`
- contest create/read/update where active
- entry creation/read/delete
- contest lock/edit restrictions

5. `drafts-and-roster-selection`
- active draft modes only
- draft room lifecycle
- roster pick validation and uniqueness

6. `standings-history-and-consent`
- standings reads
- history reads
- consent record CRUD and negative-path coverage

7. `root-admin-service-flows`
- active root-admin endpoints only
- no legacy `AdminUser` or browser-header trust assumptions

## Guardrails

- Do not add functional coverage for archived `clients/web` or removed `clients/admin` behavior.
- Do not write suites around retired concepts such as `Tenant`, `AdminUser`, `OWNER`, or header-based user/admin trust.
- Use the generated SDK and current exported DTO/domain types only.
- When a historical plan example conflicts with the live model, the live service model wins.

## Relationship To Plan 64

- Plan 64: implementation slices, harness design, pilot, and per-domain execution tasks
- Plan 66: approval, rollout, dependency management, rule ownership, CI adoption, and downstream suite retirement

## Validation

Follow the active local and CI validation gates defined in:

- [rules/workflow-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/workflow-rules.md)
- [rules/testing-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/testing-rules.md)

Functional-suite adoption work should update those rules as the strategy becomes active.
