# Plan 28: Backend Service Hardening

## Purpose

Finish removing placeholder, in-memory, and mock-backed behavior from the backend service tier so production API behavior is fully backed by persistent infrastructure and real integrations.

## Review Findings Driving This Plan

1. The social feed service is still an in-memory seeded store in production code.
2. Billing still relies on mock Stripe, mock invoices, and mock revenue analytics in production code paths.
3. Admin migration tooling is still an in-memory simulator instead of a real migration execution/reporting layer.
4. Several backend modules still rely on generic success envelopes where richer domain responses or execution state should exist.

## Scope

- `packages/core-api/src/modules/social/*`
- `packages/core-api/src/modules/billing/*`
- `packages/core-api/src/modules/admin/migration-*`
- related DTOs, mappers, tests, and seed/setup wiring

## Goals

- Replace in-memory social feed storage with durable persistence.
- Replace mock billing infrastructure with explicit integration boundaries and environment-aware implementations.
- Replace fake admin migration execution with a real job/run model.
- Keep OpenAPI, DTOs, generated clients, and tests aligned with the real runtime behavior.

## Priorities

### Priority 1

Stop shipping fabricated production behavior:

- replace seeded/in-memory social feed state
- replace mock Stripe and invoice responses in production paths
- define the real execution boundary for admin migrations

### Priority 2

Bring contracts and persistence into alignment:

- add schema/repository support
- return domain responses that reflect real execution state
- keep DTOs, mappers, OpenAPI, and generated clients in sync

### Priority 3

Increase verification after runtime behavior is real:

- add integration coverage around persistence and provider adapters
- remove tests that only validate placeholder behavior

## Implementation Phases

### Phase 1: Social feed persistence foundation

- Audit the current social module behavior and catalog everything that is still seeded or stored in memory.
- Design the Prisma model changes needed for posts, replies, reactions, moderation state, and pinned content.
- Decide which current seeded behaviors are developer fixtures versus production logic, and remove production seeding.

### Phase 2: Land social persistence end to end

- Add Prisma schema, migration, and repository access for feed entities.
- Refactor the social service layer to read and write through persistence instead of process memory.
- Update DTOs, mappers, routes, OpenAPI, generated clients, and integration coverage to reflect the persisted model.

### Phase 3: Replace mock billing infrastructure

- Introduce an explicit billing provider interface with environment-aware bindings.
- Split production provider wiring from test/dev fakes so the runtime singleton cannot silently fall back to mock behavior.
- Rework invoice reads, subscription operations, and customer state to come from real persistence or provider-backed sync data.

### Phase 4: Replace fabricated billing analytics and remaining TODO paths

- Replace hardcoded revenue analytics with aggregates derived from subscription, invoice, churn, and trial data.
- Audit the billing module for remaining fake responses, in-memory stores, or TODO-success paths.
- Tighten contracts where current responses hide missing execution detail behind generic success envelopes.

### Phase 5: Define and implement real admin migration execution

- Choose the real migration execution model, such as an ECS task, queue-backed worker, or other explicit job runner.
- Add persisted migration run records with status, timestamps, actor metadata, logs, and cancellation state.
- Refactor admin migration endpoints to create, monitor, and cancel real runs rather than simulating immediate completion.

### Phase 6: Contract cleanup and verification

- Audit endpoints that still return `SuccessSchema` even though clients need real domain or job-state responses.
- Add backend integration coverage for persistent social flows, billing provider adapters, and migration-run lifecycle behavior.
- Verify generated SDKs and frontend consumers still align with the repaired backend contracts.

## Acceptance Criteria

- Social feed APIs no longer depend on process memory or seeded production records.
- Posts, replies, reactions, and moderation state persist across process restarts.
- Billing production wiring uses an explicit provider boundary and does not ship mock Stripe behavior.
- Invoice history, invoice detail, and revenue analytics derive from real provider or persisted billing data.
- Admin migration endpoints create and report real persisted runs instead of simulated success.
- OpenAPI, shared DTOs, generated clients, and integration tests reflect the real runtime behavior.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| BSH-001 | Social | Replace [feed-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/social/feed-service.ts) in-memory maps and seeded posts with Prisma-backed storage | Not Started | Remove production seed posts and synthetic author names; persist posts, replies, reactions, and pin state in the database |
| BSH-002 | Social | Introduce feed persistence schema/repository layer and update DTO mappers/tests | Not Started | Add migration, repository, service, route, DTO, MSW/test updates |
| BSH-003 | Billing | Replace [stripe-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/stripe-service.ts) mock client with a real provider abstraction | Not Started | Keep a fake implementation only for tests/dev wiring, not as the production singleton |
| BSH-004 | Billing | Replace [invoice-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/invoice-service.ts) mock invoice generation with persisted or provider-backed invoice reads | Not Started | Invoice history/detail/upcoming preview should come from Stripe sync tables or live provider APIs |
| BSH-005 | Billing | Replace [revenue-analytics-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/revenue-analytics-service.ts) fake metrics with real aggregates | Not Started | Compute from subscriptions, invoices, churn, and trial data instead of hardcoded values |
| BSH-006 | Billing | Audit remaining billing TODOs and in-memory stores, including cancellation/dunning/usage gaps | Not Started | Focus on production-facing TODOs, especially anything still returning fabricated values |
| BSH-007 | Admin | Replace [migration-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/migration-service.ts) in-memory fake runs with persisted migration run records and real executors | Not Started | Real start/cancel/detail/history behavior; no simulated instant completion |
| BSH-008 | Admin | Define a real admin migration execution model | Not Started | Likely ECS job, queue worker, or outbox-triggered job runner with audit trail and progress persistence |
| BSH-009 | Contracts | Audit admin/config/billing endpoints still using generic `SuccessSchema` where a real domain response or job state should be returned | Not Started | Keep `SuccessSchema` only for true fire-and-forget acknowledgement endpoints |
| BSH-010 | Verification | Add backend integration coverage for persistent social, real billing adapters, and admin migration runs | Not Started | Prefer integration tests over unit-only mocks for contract-critical flows |
