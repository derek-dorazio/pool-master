# Plan 63: Tenant Removal And Auth Redesign

## Purpose

Finish the identity-boundary work that was intentionally left after the backend
refactor lane:

- fully eliminate `Tenant` from the active backend model
- remove `tenantId` from user identity, JWT/session semantics, and repository
  interfaces
- redesign authentication around the league-first product boundary defined in
  [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md)
- execute the session/auth modernization still described in
  [Plan 36](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/36-authentication-and-authorization-unification.md)

This is a follow-up architecture lane, not part of the completed backend
refactor scope.

## Why This Plan Exists

The backend refactor lane completed the product/runtime cleanup:

- no active product route now requires tenant-context gating
- league/contest/member flows are league-first
- tenant admin operations were removed
- product authorization is driven by league membership and squad membership

But several internal compatibility layers still exist:

- Prisma still contains `Tenant`
- `User.tenantId` still exists
- `League.tenantId` still exists
- `Season.tenantId` still exists
- auth token issuance still carries `tenantId`
- repository ports and service signatures still carry `tenantId` in places
- shared DTO/domain shapes still expose tenant-era identity fields

That means the product runtime is simplified, but the underlying persistence and
auth boundary are not yet fully aligned to the league-first model.

## What This Plan Covers

### 1. Full Tenant Elimination

Remove the remaining tenant-owned data model and compatibility shell:

- remove `Tenant` model from Prisma
- remove `User.tenantId`
- remove `League.tenantId`
- remove `Season.tenantId`
- remove `ImpersonationSession` or redesign it if any admin-session concept is
  still needed
- remove tenant-bound seed/bootstrap assumptions
- remove tenant references from shared domain types and DTOs
- remove tenant-bound repository interfaces

### 2. Auth Identity Redesign

Reshape auth so the backend authenticates a global user identity without tenant
 scope:

- stop issuing JWT/session state with `tenantId`
- redefine `AuthUser` around user identity and coarse capability only
- update `/auth/login`, refresh, and `/auth/me` contracts
- align auth mappers, DTOs, and tests to the new principal shape
- ensure league/scoped authorization is always DB-backed from:
  - `LeagueMembership`
  - `SquadMembership`
  - admin role/permission state

### 3. Session Model Modernization

Carry forward the still-open execution goals from Plan 36:

- move browser auth toward backend-owned cookie/session semantics
- eliminate browser-managed auth-token storage from web/admin
- unify web/admin authentication flow
- remove browser-supplied admin identity headers from any remaining runtime path

Important:

- this should happen only after the tenant-bound identity shape is removed
- do not redesign auth twice

### 4. Route / Repository / Contract Cleanup

After tenant removal, simplify code and contracts end to end:

- repository ports should stop accepting `tenantId` where league/global lookup is
  the real boundary
- contest/league services should remove compatibility `tenantId` parameters
- integration helpers/tests should stop manufacturing tenant ids
- event bus payloads should stop carrying tenant ids unless a real runtime
  consumer still requires them
- generated OpenAPI and client artifacts should remove tenant-era contract noise

## Non-Goals

- do not reopen the completed contest/scoring/prize/event-participant redesign
- do not rebuild web/admin in the same effort unless the auth/session change
  explicitly requires coordinated app work
- do not preserve old tenant behavior with compatibility shims
- do not leave a mixed model where tenant is removed from some identity paths
  but still required in others

## Recommended Execution Order

### Slice A: Lock Final Identity Boundary

Decide and document the exact post-tenant principal shape:

- `User` is global
- no `tenantId` on authenticated principal
- league/squad/admin rights are derived from DB relations

Outputs:

- final `AuthUser` shape
- final `/auth/me` response shape
- final shared domain/DTO identity fields

### Slice B: Remove Tenant From Persistence Model

Schema and migration work:

- drop `Tenant`
- drop tenant foreign keys/columns
- rebuild affected relations
- update seed/bootstrap behavior

Because this is broad and destructive, prefer a clean follow-up migration plan
rather than incremental compatibility.

### Slice C: Remove Tenant From Ports And Services

Code cleanup:

- rewrite `findById(id, tenantId)` style ports
- remove compatibility params from services
- update adapters, mappers, handlers, and tests

### Slice D: JWT / Session Contract Redesign

Auth cleanup:

- remove `tenantId` from token issuance and validation
- remove tenant from `AuthUser`
- update auth tests and integration helpers

### Slice E: Cookie/Session Unification

Finish the browser auth direction from Plan 36:

- backend-owned cookie/session model
- CSRF strategy
- refresh/session lifecycle
- admin and web on one trust model

This should likely be the final slice because it impacts clients most directly.

## Key Risks

- this is a true identity-boundary migration, not just cleanup
- it affects Prisma schema, auth, tests, generated clients, and app contracts
- if done piecemeal, it can create an inconsistent trust model
- if done too early in app coordination, it can break both web and admin

## Acceptance Criteria

- no `Tenant` model remains in the active backend schema
- no authenticated principal requires or exposes `tenantId`
- no product-facing service/repository API requires tenant context
- league and squad membership remain the sole product authorization boundary
- admin identity is enforced without browser-supplied identity headers
- auth/session contracts are internally consistent and fully tested
- OpenAPI and generated clients reflect the tenant-free model

## Relationship To Existing Plans

- [Plan 36](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/36-authentication-and-authorization-unification.md)
  remains the broader auth/session modernization plan
- [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md)
  remains the domain-boundary plan
- this plan is the focused execution bridge between those two, now that the
  backend refactor lane removed tenant from active product runtime behavior

## Task Table

| ID | Workstream | Task | Status | Notes |
| --- | --- | --- | --- | --- |
| 63-001 | 1 | Lock the final tenant-free authenticated principal shape | Pending | Must align Plan 36 and Plan 37 before implementation |
| 63-002 | 1 | Inventory every remaining `tenantId` field, JWT claim, DTO field, repository parameter, and Prisma relation still active in code | Pending | Use this to define exact migration scope |
| 63-003 | 2 | Remove `Tenant` and tenant foreign keys from the Prisma schema and baseline migrations | Pending | Includes `User`, `League`, `Season`, and any admin/session leftovers |
| 63-004 | 2 | Remove tenant-owned seed/bootstrap assumptions | Pending | Demo/bootstrap seed data is now removed; this slice must finish the tenant-free bootstrap policy and any remaining schema/runtime cleanup. |
| 63-005 | 3 | Rewrite repository ports and adapters to remove tenant-scoped lookup signatures | Pending | Avoid compatibility shims |
| 63-006 | 3 | Remove tenant compatibility parameters from league/contest/auth services and handlers | Pending | Product services should be league/global only |
| 63-007 | 4 | Remove `tenantId` from JWT/session issuance, validation, and `AuthUser` | Pending | Must include auth unit/integration coverage |
| 63-008 | 4 | Update auth DTOs, mappers, `/auth/me`, and integration helpers to the tenant-free identity model | Pending | Generated clients must stay in sync |
| 63-009 | 5 | Implement the unified cookie/session browser auth model from Plan 36 on top of the tenant-free identity boundary | Pending | Web/admin follow-through likely required |
| 63-010 | 5 | Run full backend validation and regenerate OpenAPI/client artifacts for the tenant-free auth boundary | Pending | Include unit, integration, contract, and migration checks |
| 63-011 | 5 | Add one tenant-free root bootstrap user only if still required after the final auth model is implemented | Pending | Do not reintroduce `AdminUser`; use the final unified identity model and keep bootstrap data minimal. |
