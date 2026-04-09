# Plan 62: Residual Backend Surface Cleanup

## Purpose

Inventory and remove the significant older backend surface area that still
exists after the core backend refactor, so the active codebase matches the
reviewed product scope more tightly and the overall coverage denominator drops
closer to the real product surface.

This plan focuses on leftover runtime/backend contract areas that were not part
of the completed core domain-model migration, not on the already-finished
contest/scoring/event-participant refactor.

## Why This Plan Exists

The core contest/domain refactor is in good shape, but the broad backend
coverage number is still low because a large amount of older backend surface
area remains in the repo and in the active app wiring.

The main residual areas are:

- tenant-centric platform architecture still active in auth, league, contest,
  admin, and request-context flow
- auth/session behavior still reflects tenant-scoped bearer-token assumptions
- admin tenant/platform configuration and export surfaces still active
- notifications and social subsystems are still far broader than the simplified
  first-pass communication plan
- shared DTO/domain catalogs still expose some deferred platform-era concepts
- multiple route modules still use inline JSON schemas or generic success
  responses instead of typed DTO contracts
- broad test coverage is still diluted by residual backend surface and thin
  coverage in some active orchestration modules

These are not the same thing as unfinished contest/scoring work.

## Inventory Findings

### 1. Tenant-Centric Core Still Active

These are still active in runtime and widespread in contracts:

- `Tenant` model in Prisma schema
- `tenant-context` request plugin
- auth token issuance with `tenantId`
- `LeagueService`, `ContestService`, override flows, and repositories still
  taking `tenantId`
- admin tenant management routes and services
- shared domain types and DTOs still carrying `tenantId` broadly

This is the largest remaining old architectural layer.

Related cleanup items:

- remove or constrain `Tenant`
- remove or constrain `tenant-context`
- remove `tenantId` from product-facing JWT/session semantics
- stop threading `tenantId` through league/contest product services
- remove tenant-centric admin permissions where they no longer make sense
- revisit cookie/session auth after tenant scope is removed or constrained

### 2. Admin Platform / Tenant Operations Still Active

Still active under `/api/v1/admin`:

- tenant listing/detail/suspend/unsuspend/delete
- tenant credit / trial extension
- tenant export
- impersonation
- dunning configuration
- broad platform config and platform-health surfaces

Some of this may still be intentionally useful operationally, but much of it
reflects the older tenant/billing/platform model rather than the simplified
league-first product.

### 3. Notifications And Social Are Still Oversized

The active backend still includes:

- full notification preferences
- device registration
- dispatch/test-channel routes
- scheduled notifications
- analytics-ish notification endpoints
- league social feed
- direct-message conversations
- contest chat
- share/recap style endpoints

This conflicts with the direction in:

- [Plan 48](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/48-social-and-notification-simplification.md)

which says first pass should be a simplified in-app feed model.

Additional concrete findings:

- social persistence still writes to tmpdir-backed JSON storage
- push/email/scheduled-notification runtime paths are still active
- notification preferences, device registration, templates, and scheduled
  delivery remain active in schema/runtime

### 4. Shared Contract Catalog Still Reflects Deferred Platform Concepts

The active shared type/DTO layer still exposes platform-era concepts such as:

- broad tenant ids across unrelated shapes
- admin tenant permission catalog
- deferred communication and platform config DTOs

Some of this is harmless catalog residue, but some of it keeps the backend
contract surface larger than the product scope.

### 5. Contract Hygiene Gaps Still Exist

Residual contract issues include:

- league routes still using passthrough response objects on some endpoints
- ingestion routes returning structured data but declaring `SuccessSchema`
- config and contest audit-log routes using generic success schemas instead of
  typed DTOs
- account-consent POST response still inline
- participants, leagues, drafts, and contest-management routes still using
  inline JSON request bodies in places
- events route still performing inline mapping instead of mapper-backed DTO flow

### 6. Testing And Coverage Gaps Still Exist

Residual quality gaps include:

- broad repo-level backend coverage remains low because residual backend surface
  is still active
- no dedicated API contract test suites validating response bodies against DTO
  contracts
- integration suites are still thin in negative/error-path coverage
- ingestion/unit coverage remains light
- redesigned `RosterPick` still lacks dedicated CRUD-focused DB integration
  coverage
- scoring service orchestration coverage is still shallower than the scoring
  engine coverage

### 7. Naming / Catalog Residue Still Exists

Residual cleanup items include:

- some draft/standings naming still carries old terminology
- deferred values such as `PREDICTION` remain in catalogs and should either be
  clearly documented as deferred or removed from active enums if they create
  confusion
- `packages/shared/dist/` should be rebuilt or cleaned so removed concepts do
  not linger in compiled artifacts

## What This Does Not Reopen

This plan does not question or redo:

- the squad/contest/entry/roster-pick model
- event-participant/source-data model
- scoring / aggregation / prize model
- history simplification

Those areas are already in place and should remain the foundation.

## Recommended Cleanup Order

### Slice A: Tenant Architecture Removal Or Constrainment

Execution owner:

- main thread

Goal:

- decide whether `Tenant` should be fully removed now or constrained so it is
  purely an internal platform container and no longer drives product-domain
  APIs

Likely work:

- remove `tenant-context` from normal league/contest/member request flow
- stop requiring `tenantId` in league/contest services and repositories
- reduce `tenantId` in shared domain shapes where not truly needed
- update auth so user identity is not product-scoped by tenant
- remove tenant-centric admin operations with no first-pass consumer

This is the highest-value cleanup.

Status:

- completed for first-pass runtime constrainment on `codex-backend-refactor-lane`

Implemented in this lane:

- removed tenant-context request enforcement from normal product flows
- removed product-route dependence on request tenant resolution
- normalized league membership lifecycle with active/inactive status
- kept remaining `tenantId` fields only as internal compatibility scaffolding
  in persistence/auth/admin layers, not as active product-route gating

### Slice B: Admin Platform/Tenant Surface Simplification

Execution owner:

- main thread

Goal:

- reduce `/api/v1/admin` to only the operational/admin functions that still
  matter for the first-pass product

Likely removals:

- tenant credit
- trial extension
- dunning config
- tenant export
- tenant impersonation
- any tenant-lifecycle routes with no product consumer

Likely keepers:

- provider health / ingestion operations
- migration tooling
- audit
- contest administration if still needed

Status:

- completed for first-pass backend scope

Implemented in this lane:

- removed tenant lifecycle administration routes and services
- removed tenant export and impersonation routes/services
- removed dunning, notification-channel, push-trigger, and rate-limit admin
  configuration surfaces
- reduced platform config to poll + ingestion schedule operations

### Slice C: Communication Simplification

Execution owner:

- main thread after tenant/admin boundary decisions are locked

Goal:

- make runtime communication match Plan 48

Likely work:

- remove direct-message conversations
- remove contest chat
- remove social feed post/reply/reaction surfaces
- remove push/email/test-channel/scheduled-notification runtime surfaces
- collapse toward in-app notification feed only
- replace tmpdir-backed social persistence rather than preserving it

Status:

- completed for first-pass backend scope

Implemented in this lane:

- removed social feed, direct-message, and contest-chat runtime modules
- removed push/email/scheduled-notification runtime infrastructure
- removed notification preferences/templates/device-registration/delivery-log
  schema/runtime surfaces
- kept only the in-app notification feed endpoints and `notifications` table

### Slice D: Contract Hygiene Cleanup

Execution owner:

- worker-safe after route ownership is assigned

Goal:

- make active backend contracts comply with the repo service rules

Likely work:

- replace inline JSON request schemas with shared Zod DTO schemas
- replace passthrough object responses with explicit response DTO schemas
- remove `SuccessSchema` misuse on structured responses
- add missing mapper-backed route flows where handlers still map Prisma rows
  inline

### Slice E: Testing And Coverage Cleanup

Execution owner:

- worker-safe

Status:

- in progress

Goal:

- improve confidence in the active backend and reduce the gap between branch
  rules and measured coverage

Likely work:

- add contract-focused API tests
- add more negative/error-path integration coverage
- add dedicated CRUD coverage for redesigned persistence models such as
  `RosterPick`
- increase orchestration-layer scoring tests
- revisit global coverage thresholds after residual dead surface is removed

Current worker-safe sub-slice:

- add negative contest-management contract coverage
- add dedicated `RosterPick` CRUD integration coverage

Completed in this lane:

- negative contest-management integration coverage
- dedicated `RosterPick` CRUD integration coverage

### Slice F: Shared Contract And Type Cleanup

Execution owner:

- worker-safe after the related route/runtime cleanup lands

Goal:

- shrink the shared DTO/domain catalog to active first-pass scope

Likely work:

- remove stale tenant-centric DTO fields where runtime no longer needs them
- remove deferred communication/admin DTOs after route cleanup
- remove dead exports and reduce enum/catalog leakage
- rebuild compiled shared artifacts after source cleanup

## Questions To Resolve Before Implementation

1. `Tenant` is still present in persistence/auth internals, but the active
   first-pass product runtime no longer requires tenant-context gating.

2. The remaining admin scope is now operational-only:
   provider health/ingestion, migrations, audit, users, and contest admin.

3. Communication simplification was completed in this lane rather than deferred.

4. Cookie/session auth remains a future follow-up after the identity boundary
   is simplified further.

## Proposed Acceptance Criteria

- no product-facing league/contest/member route requires tenant context unless
  explicitly justified
- `LeagueMembership` supports lifecycle status and no longer uses legacy role
  defaults
- `/api/v1/admin` no longer exposes trial/credit/dunning/export/impersonation
  features that have no first-pass consumer
- communication runtime matches the simplified in-app-feed direction

Current lane result:

- achieved for the active first-pass backend runtime
- active route contracts use typed DTO schemas rather than passthrough or
  generic success placeholders where structured data is returned
- shared DTO/domain catalogs no longer expose broad dead platform-era surface
- overall backend coverage denominator is materially reduced because dead or
  out-of-scope runtime surface has been removed

## Suggested Next Step

Treat this as the next cleanup lane after the completed core backend refactor.

Start with:

1. tenant architecture decision
2. admin tenant/platform cleanup
3. communication simplification

## Worker Dispatch Guidance

### Keep On Main Thread

- Slice A: Tenant Architecture Removal Or Constrainment
- Slice B: Admin Platform/Tenant Surface Simplification
- Slice C: Communication Simplification

Why:

- they are cross-cutting
- they affect auth, request context, shared contracts, and route boundaries
- they require product/architecture decisions before implementation details are
  safe to parallelize

### Safe To Delegate

- Slice D: Contract Hygiene Cleanup
- Slice E: Testing And Coverage Cleanup
- Slice F: Shared Contract And Type Cleanup

Suggested worker decomposition:

1. worker 1
   - replace inline JSON schemas with shared Zod DTOs
   - replace `SuccessSchema` misuse on structured responses
   - add missing mapper-backed route flows where straightforward

2. worker 2
   - add contract-focused API tests
   - add negative/error-path integration tests
   - add dedicated CRUD integration tests for redesigned models such as
     `RosterPick`

3. worker 3
   - rebuild/clean `packages/shared/dist`
   - remove stale DTO/domain exports after route cleanup
   - tighten deferred enum/catalog documentation
