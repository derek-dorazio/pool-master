# Honest Contract Remediation Guide

This document captures the recurring production defects uncovered during the cleanup pass and the standard remediation approach we should apply everywhere else in the codebase.

It is meant to be used alongside:

- [AGENTS.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/AGENTS.md)
- [rules/architecture-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/architecture-rules.md)
- [rules/service-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/service-rules.md)
- [rules/react-ui-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/react-ui-rules.md)
- [rules/testing-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/testing-rules.md)

## Core Principle

Production code must tell the truth.

If a capability is missing, broken, or only partially implemented, the application must expose the real state of that capability through:

- a real backend implementation
- a real persisted model
- a real DTO and route schema
- a real frontend error or unavailable state

It must not cover the gap with mock payloads, fake success, swallowed errors, or frontend-only models.

## Defect Patterns We Keep Finding

### 1. Fake success paths in UI

Examples:

- `setTimeout(() => toast("Success"))`
- no-op button handlers
- local optimistic success with no request
- fake cancel/pause/run actions

Required remediation:

- wire the control to a real backend endpoint, or
- remove the fake success behavior and surface the real unsupported/error state

### 2. Production mock/fallback data in services or hooks

Examples:

- `catch { return mockData }`
- seeded in-memory domain records in app code
- fake invoices, fake feeds, fake migrations, fake analytics, fake standings

Required remediation:

- remove the fallback
- implement the missing persistence/integration path
- return a truthful empty state only when empty is the actual persisted state
- otherwise raise an explicit domain error

### 3. Contract drift between backend, DTOs, generated client, and UI

Examples:

- route returns one shape but advertises `SuccessSchema`
- frontend casts local objects into a richer shape than the backend returns
- generated client has no matching operation because route schema is incomplete
- page assumes one endpoint contains unrelated derived data

Required remediation:

1. fix the backend route schema and DTOs
2. fix the mapper
3. update the frontend to parse the real DTO
4. update tests and generated artifacts when generation is available

Never patch around the problem in app code first.

### 4. In-memory or placeholder backend state

Examples:

- simulated migration runs
- singleton mock provider clients
- draft/entry/session state that only exists in local memory
- computed fallback standings instead of persisted rollups

Required remediation:

- identify the missing persisted source of truth
- model it in Prisma/domain/ports if necessary
- implement the real repository/service flow
- make the route return a real state transition, not a simulated one

### 5. Frontend-only “mega models”

Examples:

- contest detail models that invent league names, top entries, picks, or movement
- draft room models that pretend all modes share one fake shape
- scoring pages that fabricate participant rows or rule tables

Required remediation:

- split the page into the real backend queries it actually depends on
- compose those truthful responses in the page
- do not invent fields that the contract does not own

### 6. Tests validating fake behavior instead of real behavior

Examples:

- tests asserting fallback mock data appears on API failure
- MSW handlers returning obsolete envelopes
- unit tests centered on placeholder `SuccessSchema` responses

Required remediation:

- update tests after production behavior is corrected
- make MSW mirror current DTO-backed shapes
- assert truthful error/empty states where real implementation is not yet complete

## Approved Remediation Workflow

Apply this sequence in order.

1. Find the dishonest behavior.
2. Identify the missing source of truth.
3. Fix the backend or persistence root cause first.
4. Align DTOs, mappers, and route schemas.
5. Align frontend queries and rendering with the real contract.
6. Add or repair tests around the real behavior.
7. Update the relevant plan rows with what changed and what remains.

## Decision Rules

### When to return empty vs. error

Return empty only when the real persisted state is empty.

Return an explicit error when:

- the capability depends on missing infrastructure
- synchronization has not happened
- required rollups or derived records do not exist yet
- the route cannot truthfully satisfy its contract

### When to disable vs. implement

If the backend exists or can be implemented in-scope, implement it.

If the backend does not exist yet and the user flow cannot be completed truthfully, do not claim success. Surface the real unsupported state and track the root cause in plans.

### When a model/schema change is required

If the missing behavior cannot be represented by the current persisted model, change the model instead of adding a fake compatibility layer.

Recent examples:

- expanded `contest_picks` for matchup-based pick'em
- added `contest_matchups` so prediction rooms have a real source of truth
- added real contest-entry self-service routes instead of implicit frontend-only participation

## What “Done” Looks Like

A slice is only done when all of the following are true:

- no production mock/fallback path remains in the touched flow
- backend behavior is backed by a real persisted or integrated source
- DTOs/routes/mappers match runtime behavior
- frontend uses the real contract without unsafe local shape extension
- tests validate the repaired behavior
- plan docs note both what was fixed and what root causes still remain

Recent examples of compliant remediation in progress include the admin, billing, settings/compliance, and social contract lanes: they now use shared DTO-backed routes and truthful frontend states, but some backend persistence layers are still intentionally marked as follow-up work rather than being overstated as finished.

## Safe Parallelization Rules

Multiple agents can work safely if each lane has:

- a disjoint write scope
- a clear owning plan row or module area
- the same remediation workflow

Good parallel lanes:

- `clients/web/src/features/settings/**` + related compliance/account routes
- `clients/admin/src/**` + `packages/core-api/src/modules/admin/**`
- `packages/core-api/src/modules/billing/**` + `clients/web/src/features/billing/**`
- `packages/core-api/src/modules/social/**` + `clients/web/src/features/social/**`
- `packages/core-api/src/modules/history/**` + `clients/web/src/pages/history/**`

Avoid parallelizing two agents in the same module tree unless the write scopes are explicitly separated first.

## Review Checklist For Each Slice

- Is there any fake success path left?
- Is there any swallowed error left?
- Is there any `SuccessSchema` placeholder masking real data?
- Is the frontend inventing fields the backend does not own?
- Does the backend rely on in-memory or seeded fake records?
- Do tests still encode fallback behavior that no longer belongs?
- Did the relevant plan docs get updated?
