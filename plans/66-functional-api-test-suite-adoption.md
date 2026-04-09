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
| Pending | Create `tests/functional/` harness | Add Jest config, app lifecycle, SDK client setup, and cleanup helpers |
| Pending | Add reusable authenticated client and builder utilities | Prefer shared helpers when object-graph setup repeats across files |
| Pending | Add CRUD-focused functional suites for active backend domains | Ensure create/read/update/delete and common negative cases are covered |
| Pending | Add use-case workflow functional suites aligned with active plans | League, contest, entry, draft, scoring, history, consent |
| Pending | Add authorization and permission-path assertions | Include 401, 403, wrong-league, wrong-role, and ownership checks where applicable |
| Pending | Add error-envelope assertions | Validate status plus error body shape on migrated routes |
| Pending | Integrate functional suite into local build/test flow | Add package scripts and document expected local gate usage |
| Pending | Integrate functional suite into CI | Include in backend quality gates and coverage merge flow |
| Pending | Update rules/docs to reflect the new test strategy | Testing rules, workflow references, AGENTS/README where appropriate |

## Validation

- `npx turbo typecheck --filter=@poolmaster/core-api --filter=@poolmaster/shared --force`
- `npx eslint 'packages/core-api/src/**/*.ts' 'packages/shared/**/*.ts' 'tests/**/*.ts' --max-warnings 0`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/jest.config.js --forceExit`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/integration/jest.config.js --forceExit`
- functional API suite command once introduced
- merged backend coverage command once updated
- `npm run api:export`
- `npm run api:validate`
- `npm run api:generate`
