# Plan 43: Backend-First Refactor Execution Strategy

## Purpose

Provide an execution strategy for the large PoolMaster domain refactor so the
team can stabilize the backend first before rebuilding web and admin against the
new contracts.

This plan is intentionally about delivery strategy, not final domain design.
The target model is defined by:

- [Plan 36](./36-authentication-and-authorization-unification.md)
- [Plan 37](./37-league-top-level-domain-and-data-simplification.md)
- [Plan 38](./38-contest-entry-and-squad-alignment-review.md)
- [Plan 41](./41-contest-history-user-cases.md)
- [Plan 42](./42-history-simplification.md)

## Recommended Strategy

Recommended approach:

- do **not** start over in a new repository
- do **not** rebuild the web apps in parallel with the backend redesign
- do the work on a dedicated long-lived backend refactor branch or epic lane
- treat the backend as the contract source of truth
- stabilize:
  - database schema
  - domain entities
  - repositories/adapters
  - services
  - DTOs
  - mappers
  - routes/OpenAPI
  - generated client export
- only after that, adapt web and admin to the new contracts

This avoids churn where frontend work keeps fighting a backend model that is
still moving.

## Branch And Delivery Model

Recommended delivery model:

- keep `main` stable for ordinary work
- create a dedicated backend-refactor lane for this effort
- merge changes into `main` in coherent backend-first slices only when the
  service-side contract is internally consistent
- defer app rebuild work until the backend/API/export layer is stable enough to
  consume

Current execution lane bootstrap:

- dedicated branch: `codex-backend-refactor-lane`
- branch-specific CI rules should keep backend checks required while skipping
  web/admin test jobs and combined coverage summary on that branch

## Testing Strategy During Refactor

During the backend-first refactor lane, the required confidence signals should
focus on service-side correctness.

Primary gates:

- Prisma schema correctness
- migration safety for the chosen migration strategy
- backend typecheck
- backend lint
- backend unit tests
- database-backed integration tests
- DTO / route / OpenAPI contract validation
- generated client export validation

De-emphasized during the backend-first phase:

- web app feature tests
- admin app feature tests
- smoke tests
- browser E2E
- deployed flow validation

Important guardrail:

- do not permanently disable frontend validation on normal `main`
- instead, use a dedicated backend-refactor workflow or branch-specific required
  checks during the refactor period

## CI Strategy Recommendation

Recommended CI shape for the backend-refactor lane:

### Required

- service typecheck
- service lint
- backend unit tests
- DB integration tests
- migration/apply validation
- OpenAPI generation and validation
- generated client refresh/validation

### Optional / informational only

- web compile
- admin compile
- frontend tests

### Disabled as required gates for the refactor lane

- smoke tests
- browser E2E
- post-deploy validation suites

Reason:

- these suites validate the existing app contract
- the backend contract is intentionally being redesigned
- keeping them as hard gates too early creates noise instead of signal

## Migration Strategy

This refactor changes too many top-level concepts at once:

- remove `Tenant`
- remove or reshape `Season`
- change `ContestEntry` ownership
- introduce `Squad`
- simplify contest/result/history models
- reshape selection models
- remove or replace multiple legacy tables

Because of that, the recommended migration strategy is:

### Recommended migration approach

- perform a **schema reset / fresh baseline migration** for the refactor target
  model rather than trying to preserve every legacy table and relationship

This means:

- drop the old tables in development and QA environments
- create a new baseline migration for the refactored schema
- rebuild test environments from that new baseline

Why this is recommended:

- the domain model is being intentionally redesigned, not incrementally tuned
- trying to evolve all legacy tables in place will create noisy migrations and
  lots of temporary compatibility baggage
- many existing tables are intentionally being removed
- the application is not trying to preserve mature production data history at
  this stage

### Alternative approach

- continue evolving the migration chain in place

Why this is not recommended:

- it will preserve old assumptions in the schema too long
- it increases adapter and data-backfill complexity
- it makes the final model harder to reason about

### Migration guardrail

- if a later requirement emerges to preserve real user production data, create a
  dedicated migration/conversion plan for that specific dataset
- do not let hypothetical future preservation needs force the first-pass schema
  to remain tangled now

## Seed Data Strategy

Recommended seed strategy:

- remove all broad seed data
- remove all contest/member/league/participant/demo/sample bootstrap data
- keep only one root admin bootstrap user:
  - `derek.dorazio@gmail.com`

Why:

- seed data drifts quickly during a major model refactor
- seed data has already proven to be a poor place for test fixtures
- tests should create and destroy their own data
- mock-provider scenarios should own non-production contest/event fixture data

### First-pass seed contract

Allowed:

- one root admin account bootstrap record
- essential static/default platform configuration only if the service cannot run
  without it

Not allowed:

- fake leagues
- fake members
- fake contests
- fake participants for application runtime
- fake odds
- fake results
- test fixtures in application seed scripts

### Testing data strategy

- unit tests use local fixtures/builders
- integration tests create their own DB state
- smoke and E2E tests create and destroy their own data
- non-production event/participant feeds should come from
  [Plan 31](./31-mock-contest-feed-provider.md),
  not application seeds

## Implementation Phases

### Phase 1: Lock target backend model

- finalize model plans
- finalize service-side contract direction
- decide which legacy models are removed vs deferred

### Phase 2: Reset schema and rebuild service-side persistence

- replace legacy schema with the new target schema
- create fresh baseline migration
- rebuild repositories and Prisma adapters
- remove legacy history/payout/season/tenant artifacts from persistence

### Phase 3: Rebuild service contracts

- update shared domain types
- update DTOs
- update mappers
- update routes/OpenAPI
- regenerate clients

### Phase 4: Backend-first validation

- add/update backend unit tests
- add/update DB integration tests
- validate migration/bootstrap/test environment creation
- validate generated client export

### Phase 5: App adaptation

- regenerate client for consumers
- rebuild web/admin against stable contracts
- reintroduce frontend and browser validation as hard gates

## Non-Goals During Backend-First Phase

The following should not block backend-first implementation:

- preserving current web/admin behavior during refactor
- keeping old smoke/E2E suites green while the contract is intentionally changing
- maintaining seed-driven QA flows
- preserving legacy history/analytics tables just in case they are useful later

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 43-001 | 1 | Create dedicated backend-first execution strategy | Done | This plan |
| 43-002 | 1 | Run the domain/model review plans to completion before implementation starts | Pending | Plan 36, 37, 38, 42 should be stable enough to build against |
| 43-003 | 2 | Create a backend-refactor CI lane focused on service-side validation only | Done | Added branch-specific rule exceptions and CI gating for `codex-backend-refactor-lane`; web/admin/coverage-summary are skipped there while backend checks remain required |
| 43-004 | 2 | Adopt schema reset / fresh baseline migration strategy for the refactor target model | Pending | Dev and QA can be rebuilt from scratch |
| 43-005 | 2 | Remove broad application seed data and reduce seed contract to root admin + essential bootstrap config only | Done | Removed all demo/dev/bootstrap seed records and replaced the seed step with a no-op so migrate/seed pipeline paths still execute; root bootstrap user is deferred to Plan 63 after the tenant-free auth model lands. |
| 43-006 | 2 | Move all non-production contest/event fixture needs behind mock-provider and test-owned data creation | Pending | Align with Plan 31 |
| 43-007 | 3 | Rebuild Prisma schema, domain entities, repositories, and service logic against the new model | Pending | Backend only |
| 43-008 | 3 | Rebuild DTOs, mappers, routes, OpenAPI, and generated client export | Pending | Backend contract becomes source of truth |
| 43-009 | 4 | Replace legacy backend tests with backend-first unit/integration/contract coverage aligned to the new model | Pending | Remove tests that enforce removed architecture |
| 43-010 | 5 | Re-enable app adaptation and frontend/browser validation only after backend contracts stabilize | Pending | Web/admin follow backend |

## Acceptance Criteria

- backend implementation can proceed without web/admin rebuild pressure
- migration approach is explicitly chosen and documented
- seed strategy is explicitly reduced to no inserted data until the tenant-free auth/root bootstrap model is completed
- backend CI gates focus on service-side correctness during refactor
- frontend adaptation is explicitly sequenced after backend/API stabilization
