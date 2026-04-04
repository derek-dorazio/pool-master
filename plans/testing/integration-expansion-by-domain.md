# Integration Expansion By Domain

> **Planning Note (2026-04-03):** Re-analyze the current MVP routes, deferred features, and live DTO contracts before adding or reviving suites. Do not expand coverage for deferred product areas unless the product plan is updated first.

## Purpose

Expand the rebuilt integration test suite beyond the initial CRUD/read-flow baseline using small, self-contained suites grouped by product domain.

This phase should:

- strengthen confidence in the narrowed MVP path
- add negative-path validation around permissions and invalid state transitions
- keep shared helper changes centralized while allowing safe parallel worker execution

## Baseline Complete

The following suites now exist and should be treated as the seed pattern:

- `contest-crud.integration.ts`
- `league-crud.integration.ts`
- `member-invitation-crud.integration.ts`
- `contest-entry-crud.integration.ts`
- `draft-session-flow.integration.ts`
- `standings-results-read.integration.ts`

## Rules For Expansion

- Prefer one product flow or failure mode per suite.
- Create data through real routes unless the route under test reads persisted state that must be seeded directly.
- Use shared domain enums/constants, not magic strings where a shared enum exists.
- Strip `content-type` from bodyless POST/DELETE requests when required by the live route contract.
- Keep shared helpers in `tests/integration/helpers.ts` minimal and generic.
- Run DB-backed suites outside the sandbox when they need developer-local Postgres.
- Keep deferred feature coverage out of this phase unless product scope changes.

## Worker Ownership

### Worker 1: Contest and Draft Variants

- Add alternate supported MVP contest-flow suites
- Focus on:
  - budget pick room flow
  - contest create/update validation for supported tournament modes
  - contest entry invalid-state behavior after selection submission

Write scope:

- `tests/integration/core-api/*contest*.integration.ts`
- `tests/integration/core-api/*draft*.integration.ts`

Do not edit shared helpers unless blocked; report helper needs back to the main thread.

### Worker 2: History / Feed / Dashboard Reads

- Add read-model suites for:
  - league history summaries
  - dashboard recent activity / feed-backed reads
  - minimal active/finished contest history surfaces

Write scope:

- `tests/integration/core-api/*history*.integration.ts`
- `tests/integration/core-api/*social*.integration.ts`
- `tests/integration/core-api/*dashboard*.integration.ts`

Do not change contest/draft shared helpers without coordination.

### Worker 3: Negative Paths and Permissions

- Add suites for:
  - unauthorized requests
  - non-member access denial
  - commissioner-only route enforcement
  - invalid state transitions (cannot leave after picks, cannot enter after close, etc.)

Write scope:

- `tests/integration/core-api/*permission*.integration.ts`
- `tests/integration/core-api/*negative*.integration.ts`
- targeted domain suites if isolated to failure-path coverage

Do not refactor route behavior; surface contract issues back to the main thread.

## Main Thread Ownership

Keep these on the main thread:

- `tests/integration/helpers.ts`
- route-contract drift fixes discovered by workers
- DTO or OpenAPI changes required to make live routes testable
- any cross-domain fixture builder or cleanup changes

## Batch Order

1. Budget pick room flow
   - Status: Done
   - create budget contest
   - create entry
   - seed contest pool with prices
   - submit selection
   - verify read-after-write state

2. Permission and invalid-state flows
   - Status: Done
   - non-member cannot enter contest
   - member cannot leave after picks
   - non-commissioner cannot invite/remove/change role

3. History and dashboard reads
   - Status: Done
   - league results/history summary
   - feed-backed recent activity
   - active vs finished contest read surfaces

4. Supported contest validation edges
   - Status: Done
   - invalid create payloads for kept MVP modes
   - unsupported deferred mode requests remain clearly rejected at the API contract boundary

## Acceptance Criteria

- New suites remain self-contained and independently runnable.
- Shared helper drift stays small and deliberate.
- Coverage expands across success and failure paths for the kept MVP flows.
- Worker lanes do not collide on shared helpers or route-contract files.
- Any discovered contract bug is either fixed on the main thread or written back into plans as a tracked follow-up.
