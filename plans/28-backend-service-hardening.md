# Plan 28: Backend Service Hardening

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

## Purpose

Finish removing placeholder, in-memory, and mock-backed behavior from the backend service tier so production API behavior is fully backed by persistent infrastructure and real integrations.

## Current MVP Interpretation

Keep this hardening work aligned to the narrowed launch scope:

- prioritize leagues, invitations, contests, draft-once tournament flows, scoring, and standings
- keep billing, rich social, and non-MVP contest families secondary
- if a backend path only serves a deferred feature family, prefer documenting or deferring it over expanding it now

## Review Findings Driving This Plan

1. The social feed service is still an in-memory seeded store in production code.
2. Billing still relies on mock Stripe, mock invoices, and mock revenue analytics in production code paths.
3. Admin migration tooling is still an in-memory simulator instead of a real migration execution/reporting layer.
4. Several backend modules still rely on generic success envelopes where richer domain responses or execution state should exist.
5. Additional admin tooling still ships mock-backed production services, including provider operations, support investigation data, digest previews, impersonation tokens, and quick actions.
6. Billing dunning and cancellation flows still rely on in-memory state in production code instead of persisted execution records.

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
| BSH-004 | Billing | Replace [invoice-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/invoice-service.ts) mock invoice generation with persisted or provider-backed invoice reads | In Progress | Removed the fabricated invoice generator. Invoice history now returns truthful empty results, while preview/detail explicitly surface the missing provider-backed invoice persistence with `INVOICE_SYNC_UNAVAILABLE`; next step is adding real invoice storage/sync |
| BSH-005 | Billing | Replace [revenue-analytics-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/revenue-analytics-service.ts) fake metrics with real aggregates | Not Started | Compute from subscriptions, invoices, churn, and trial data instead of hardcoded values |
| BSH-006 | Billing | Audit remaining billing TODOs and in-memory stores, including cancellation/dunning/usage gaps | Not Started | Focus on production-facing TODOs, especially anything still returning fabricated values |
| BSH-007 | Admin | Replace [migration-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/migration-service.ts) in-memory fake runs with persisted migration run records and real executors | In Progress | Implemented Prisma-backed queued/cancelled run persistence and removed the fake instant-complete path; next step is wiring the real executor that advances queued runs |
| BSH-008 | Admin | Define a real admin migration execution model | In Progress | First slice landed: runs are now persisted with explicit `QUEUED` state instead of simulated completion; follow-up still needed for worker/ECS execution and progress updates |
| BSH-009 | Contracts | Audit admin/config/billing endpoints still using generic `SuccessSchema` where a real domain response or job state should be returned | In Progress | Admin migration routes now return real list/detail/run DTOs via shared schemas, scoring routes now publish explicit leaderboard/entry-score/participant-score/rollup/health DTO schemas instead of anonymous success envelopes, and draft routes now return explicit mode-aware draft-room DTOs with real entry/user/pick metadata for snake, open-selection, tiered, pick'em, and bracket contests instead of passthrough objects. Contest self-leave now also returns an explicit deletion DTO instead of a `204` no-content hole, which keeps OpenAPI/client validation honest for `/api/v1/contests/:contestId/entries/me`. The pick'em/bracket stack now exposes matchup-backed room state over persisted `contest_matchups`, `contest_picks`, and `bracket_predictions`, plus real bracket reset/auto-fill endpoints and full snake-draft commissioner responses for pause/resume/extend/undo/skip. Entry score detail responses now also carry persisted matchup/round context when a score event can be tied unambiguously to a saved pick or bracket prediction, so downstream scoring pages no longer flatten those modes into generic participant-only rows. `EVENT_FIELD` pool resolution now hydrates real event participants and seeds pick'em/bracket matchup rows from ingested event metadata instead of returning an empty pool. Contest creation now also treats event-backed pool/tier/pricing provisioning as part of the real setup contract and cleans up the draft contest if that provisioning fails, rather than leaving behind a half-configured shell contest. Pricing/tier services now consume the best available event metadata and season-record signals for odds, seed, ranking, and stored budget price, so `BUDGET_PICK` and `TIERED` contests no longer quietly flatten to ranking-only behavior when the underlying event import already has stronger tournament signals |
| BSH-010 | Verification | Add backend integration coverage for persistent social, real billing adapters, and admin migration runs | In Progress | Added admin migration contract coverage in [api-contracts-admin.integration.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/tests/integration/core-api/api-contracts-admin.integration.ts); execution is currently blocked locally because Postgres was not reachable on `localhost:5432` |
| BSH-011 | Admin | Remove mock-backed provider operations in [provider-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/provider-service.ts) and replace them with real provider registry / job data | Not Started | Current admin provider dashboards, unmapped participants, and ingestion jobs are still fabricated in production code |
| BSH-012 | Admin | Replace mock support investigation data in [support-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/support-service.ts) with real persisted operational data or remove unsupported views | Not Started | Recent errors, notification failures, request samples, and staleness views should not be synthetic |
| BSH-013 | Admin | Remove remaining fake admin execution helpers such as [quick-actions-handler.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/quick-actions-handler.ts), [digest-config-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/digest-config-service.ts), and [impersonation-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/impersonation-service.ts) | Not Started | Replace mock checks/tokens/previews with real integrations or disable unsupported actions |
| BSH-014 | Billing | Replace in-memory cancellation and dunning tracking in [cancellation-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/cancellation-service.ts) and [dunning-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/billing/dunning-service.ts) with persisted models | Not Started | The cleanup scan surfaced production Maps and “realistic mock metrics” that need to be eliminated |
