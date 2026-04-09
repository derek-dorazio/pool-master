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

The direction in [plans/64-sdk-functional-test-suite.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/64-sdk-functional-test-suite.md) is strong and should be adopted with these clarifications:

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
- merged coverage integration with existing backend coverage reporting
- local and CI execution wiring

### Out of Scope

- deployed-environment smoke journeys
- browser-driven user flows
- web/admin rebuild work
- future tenant/auth redesign from Plan 63

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
- permission boundaries by member/commissioner/admin role

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
| Pending | Finalize the functional-suite naming and scope | Use “functional API test suite” consistently in scripts, docs, and CI |
| Pending | Adopt Plan 64 Slice 64-A as the required pilot gate | Do not expand into domain coverage until the pilot harness is green locally and in CI |
| Pending | Execute the domain coverage slices from Plan 64 | Track implementation progress in Plan 64 task rows rather than duplicating per-domain slice rows here |
| Pending | Integrate functional suite into local build/test flow | Add package scripts and document expected local gate usage |
| Pending | Integrate functional suite into CI | Include in backend quality gates and coverage merge flow |
| Pending | Own cross-rule/docs updates for the new test strategy | Testing rules, workflow references, AGENTS/README where appropriate |
| Pending | Define and execute redundant-test pruning after coverage is in place | Remove integration/contract tests only when the functional suite clearly replaces their signal |

## Relationship To Plan 64

- Plan 64: implementation slices, harness design, pilot, and per-domain execution tasks
- Plan 66: approval, rollout, dependency management, rule ownership, CI adoption, and downstream suite retirement

## Validation

Follow the active local and CI validation gates defined in:

- [rules/workflow-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/workflow-rules.md)
- [rules/testing-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/testing-rules.md)

Functional-suite adoption work should update those rules as the strategy becomes active.
