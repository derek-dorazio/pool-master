# Plan 45: League-First Administration Migration

## Purpose

Migrate PoolMaster administration away from a separate tenant-first admin model
and toward a league-first administration model where:

- commissioners administer their leagues
- root admins act as super-commissioners across all leagues
- only true platform concerns remain outside league scope

This plan should stay aligned with:

- [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md)
- [Plan 36](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/36-authentication-and-authorization-unification.md)
- [Plan 44 Companion: League-First Commissioner Administration User Cases](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/44-league-first-commissioner-administration-user-cases.md)

## Recommended Direction

Recommended administration model:

- no separate product administration experience for league-owned actions
- commissioner tools become the primary administration path
- root admin can select any league and use the same commissioner tools
- a much smaller platform/system admin surface remains for provider, health,
  config, migration, and audit operations

## Target Administration Split

### League-scoped commissioner administration

Move to commissioner tools:

- league settings
- league member role management
- invitations
- contest administration
- contest configuration
- commissioner corrective actions on entries and scoring
- squad and contest-entry operational management

### Platform/system administration

Keep outside league scope:

- provider/feed management
- ingestion operations
- health and alerts
- migrations
- platform config
- audit
- future billing/platform finance operations

## Current Admin Surface Assessment

### Current admin app areas

The current admin app includes:

- announcements
- audit
- config
- contests
- flags
- health
- migrations
- providers
- tenants
- users

### Migration intent by area

#### Move to commissioner tools

- contests
  - detail/operational actions should become league-scoped commissioner actions

#### Keep as system admin tools

- providers
- health
- migrations
- audit
- platform config

#### Remove or defer for now

- flags
- announcements
- support / quick actions

#### Redesign due to tenant removal

- tenants
- tenant-based exports
- tenant retention overrides
- tenant plan/suspension actions

#### Revisit later

- users
- impersonation
- billing administration

## Authorization Model Direction

### Commissioner authorization

Commissioner APIs should authorize using:

- active league
- membership role in that league

### Root admin authorization

Root admin should implicitly pass commissioner authorization for any league.

This means:

- root admin can call league-scoped commissioner APIs for any league
- no separate duplicated admin-only route is needed for most league-owned tasks

### System admin authorization

System admin APIs should remain separate for true platform concerns such as:

- provider configuration
- ingestion schedule
- health
- migrations
- platform config
- audit

## Backend Migration Strategy

### Phase 1: Classify existing admin endpoints

For every current `/api/v1/admin/*` endpoint, classify it as one of:

- commissioner tool
- system admin tool
- tenant-bound legacy surface to remove or redesign

### Phase 2: Move league-owned admin behaviors

- replace league-owned admin endpoints with league-scoped commissioner APIs
- update services so league ownership and commissioner role drive authorization
- ensure root admin can satisfy those same authorization checks implicitly

### Phase 3: Reduce tenant-first admin dependencies

- remove or redesign tenant-specific admin services
- remove admin assumptions that the top-level product boundary is tenant

### Phase 4: Stabilize the remaining system admin surface

- provider operations
- health
- migrations
- audit
- platform config

These become the intentionally small platform-admin layer.

## Immediate Recommendations

The strongest first steps are:

1. stop expanding the separate admin app for league-owned behavior
2. treat admin contest operations as commissioner-tool candidates
3. stop designing new tenant-based admin flows
4. preserve only the small set of true platform/system admin capabilities
5. remove speculative site-admin features that do not support active operational needs

## Open Design Questions

These remain open and should be handled in later focused passes:

1. Should the separate admin app eventually disappear entirely, or remain only as
   a small platform-ops console?
2. How much of current global user management should remain as platform admin
   tooling?
3. Should impersonation survive in the long term, and if so under what guardrails?
4. How should future billing administration fit once leagues become the paid
   unit?

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 45-001 | 1 | Define league-first administration principles | Done | Captured in Plan 44 |
| 45-002 | 1 | Inventory current admin app and admin API surfaces | Done | Mapped into commissioner vs system-admin classes |
| 45-003 | 2 | Identify all current admin contest operations that should become commissioner APIs | Pending | Root admin should reuse same league-scoped paths |
| 45-004 | 2 | Design league selector and active-league authorization model for multi-league users and root admins | Pending | League switch should refetch state and role |
| 45-005 | 2 | Define root-admin-as-super-commissioner authorization behavior in backend services | Pending | No duplicated league-owned admin logic |
| 45-006 | 3 | Decompose `/admin/tenants/*` surfaces into league-first replacements or removals | Pending | Tenant model is being removed |
| 45-007 | 3 | Stabilize small system-admin surface for providers, health, migrations, config, and audit | Pending | Remaining platform console |
| 45-008 | 3 | Remove or defer speculative site-admin surfaces such as flags, announcements, and quick actions | Pending | Keep the platform console intentionally small |
| 45-009 | 4 | Revisit global user management, impersonation, and billing admin as separate focused design topics | Pending | Explicitly not blocking core administration simplification |

## Acceptance Criteria

- league-owned administration is defined as commissioner-first
- root admin super-commissioner behavior is explicitly documented
- current admin surfaces are mapped into commissioner tools vs system admin tools
- tenant-first admin assumptions are identified for removal or redesign
