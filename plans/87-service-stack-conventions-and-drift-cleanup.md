## Objective

Perform a comprehensive conventions-and-drift review of the active PoolMaster
service stack, document all cleanup tasks, immediately remediate the clear
items, and leave only true product/reviewer decisions for follow-up review.

## Scope

- persistence model consistency against
  [rules/domain-model-conventions-rules.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/rules/domain-model-conventions-rules.md)
- DTO/entity/persistence drift
- stale or orphaned service-stack surface
- placeholder/scaffolded backend and frontend surfaces that should be either
  cleaned up or explicitly reviewed
- contract/documentation mismatches surfaced during the audit

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 87-001 | 1 | Create comprehensive audit plan and consolidate local + domain-modeler review | Done | Local audit and domain-modeler review consolidated below. |
| 87-002 | 1 | Identify persistence fields that violate closed-set enum conventions | Done | League/member/invitation/squad, commissioner action items, participants, contest/draft, and provider-ingestion status mismatches identified. |
| 87-003 | 1 | Identify DTO/entity mismatches, stale contract surface, and orphaned model remnants | Done | Active contract drift and placeholder-backed fields captured below. |
| 87-004 | 1 | Identify placeholder/scaffolded routes or UI surfaces that should be cleaned or reviewed | Done | Auth placeholder routes, deferred UI affordances, and stale docs captured below. |
| 87-005 | 2 | Remediate clear, low-risk convention violations immediately | Done | Completed enum hardening, placeholder-route cleanup, root-admin surface cleanup, role-model simplification, provider status alignment, and generated-contract refresh. |
| 87-006 | 2 | Mark all remaining items as `Needs Review` where product or architecture judgment is required | Done | Remaining contest/config review was triaged and intentionally deferred into feature-specific plans. |
| 87-007 | 1 | Audit candidate removable fields and placeholder-backed contract surface | Done | Field-level review completed; obvious and approved removals were executed in this lane. |
| 87-008 | 2 | Remove approved placeholder or speculative fields once reviewed | Done | Completed for approved items. Remaining contest/ingestion model review is intentionally deferred to future feature plans. |

## Findings

### Remediated In This Audit

#### League/member/invitation/squad persistence enum cleanup

Completed in this audit:

- promoted reviewed league/member/invitation/squad choice sets to Prisma enums
- removed several broad-string adapter casts and literal Prisma status filters
- refreshed OpenAPI and generated SDK/types

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/core-api/prisma/migrations/20260414103000_promote_league_membership_invitation_enums/migration.sql](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/migrations/20260414103000_promote_league_membership_invitation_enums/migration.sql)
- [packages/core-api/src/adapters/prisma-league-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-league-repository.ts)
- [packages/core-api/src/adapters/prisma-league-membership-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-league-membership-repository.ts)
- [packages/core-api/src/adapters/prisma-league-invitation-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-league-invitation-repository.ts)
- [packages/core-api/src/adapters/prisma-squad-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-squad-repository.ts)
- [packages/core-api/src/adapters/prisma-squad-membership-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-squad-membership-repository.ts)

Validation passed:

- `npm run api:refresh`
- `npm run api:validate`
- `npx turbo typecheck --filter=@poolmaster/shared --filter=@poolmaster/core-api --filter=@poolmaster/poolmaster --force`
- `npx eslint 'packages/*/src/**/*.ts' --max-warnings 0`
- `cd clients/poolmaster && npx vitest run`
- `npm run build:poolmaster`
- `npm run test:coverage:service:fresh`

#### Authentication/authorization doc drift cleanup

Completed in this audit:

- removed stale claims that admin auth still uses header-only placeholder gating
- updated the document to describe the live root-admin plugin and current runtime behavior
- removed stale league-role wording that no longer matches the active commissioner/member model
- refreshed generated contract artifacts so removed placeholder auth routes no longer
  appear in `openapi.json`, Hey API output, or `api-types.ts`

Representative file:

- [docs/AUTHENTICATION-AUTHORIZATION.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/AUTHENTICATION-AUTHORIZATION.md)

#### Provider ingestion status mismatch cleanup

Completed in this audit:

- aligned admin provider ingestion job status from stale `QUEUED` to the real ingestion lifecycle state `PENDING`

Representative files:

- [packages/core-api/src/modules/admin/provider-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/provider-service.ts)
- [packages/shared/dto/admin.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/admin.dto.ts)

#### Commissioner action item simplification

Completed in this audit:

- removed speculative `type` and `priority` from commissioner action items
- simplified persistence, domain, DTO, repository ordering, and tests to keep only the fields the current product actually uses

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/core-api/prisma/migrations/20260414111500_drop_action_item_type_and_priority/migration.sql](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/migrations/20260414111500_drop_action_item_type_and_priority/migration.sql)
- [packages/core-api/src/adapters/prisma-action-item-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-action-item-repository.ts)
- [packages/shared/domain/types.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/domain/types.ts)
- [packages/shared/dto/leagues.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/leagues.dto.ts)

#### Root-admin user surface simplification

Completed in this audit:

- removed speculative root-admin user relational collections from the active DTO surface
- collapsed root-admin user reads back to the core `User` profile shape
- removed the speculative `/api/v1/admin/users/merge` route and service flow

Representative files:

- [packages/core-api/src/modules/admin/user-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/user-service.ts)
- [packages/core-api/src/modules/admin/user-handler.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/user-handler.ts)
- [packages/core-api/src/modules/admin/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/routes.ts)
- [packages/shared/dto/admin.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/admin.dto.ts)

#### Root-admin contest-surface removal and league-commissioner alignment

Completed in this audit:

- removed the speculative root-admin contest-management surface entirely
- deleted the dedicated admin contest routes, handlers, service, DTOs, and
  test coverage that implied a parallel contest-ops domain
- aligned root-admin with the normal league commissioner path for core league
  lifecycle access
- expanded authenticated request context so `isRootAdmin` flows through the
  normal app auth session
- made root-admin see all leagues from the normal league list surface and act
  as commissioner for league-scoped management routes without requiring a
  stored league membership row

Representative files:

- [packages/core-api/src/modules/admin/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/routes.ts)
- [packages/core-api/src/modules/leagues/permissions.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/permissions.ts)
- [packages/core-api/src/modules/leagues/handler.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/handler.ts)
- [packages/core-api/src/modules/leagues/service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/service.ts)
- [packages/core-api/src/plugins/auth-guard.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/plugins/auth-guard.ts)
- [packages/core-api/src/modules/auth/auth-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/auth/auth-service.ts)
- [packages/shared/dto/admin.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/admin.dto.ts)

#### League membership role-model simplification

Completed in this audit:

- removed `LeagueMembership.permissions` from persistence, domain types, DTOs, repository mapping, and tests
- replaced commissioner permission checks with direct commissioner-role checks
- removed the speculative commissioner-permission catalog and related helper infrastructure

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/core-api/prisma/migrations/20260414123000_drop_league_membership_permissions/migration.sql](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/migrations/20260414123000_drop_league_membership_permissions/migration.sql)
- [packages/core-api/src/modules/leagues/permissions.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/permissions.ts)
- [packages/core-api/src/modules/leagues/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/routes.ts)
- [packages/core-api/src/modules/contests/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/contests/routes.ts)
- [packages/core-api/src/modules/contest-management/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/contest-management/routes.ts)

### Field-Level Review Table

| Area | Field / Surface | Status | Why suspicious |
|---|---|---|---|
| Root-admin user reads | `leagues` on admin user list/detail DTOs | Removed | Parallel admin-user collections were eager feature guesses rather than core user-model truth. |
| Root-admin user reads | `activeContests` on admin user detail DTO | Removed | Same issue: a speculative relational expansion that was not required by the current root-admin surface. |
| Root-admin user ops | `POST /api/v1/admin/users/merge` | Removed | High-risk ops behavior with no active reviewed product need. |
| Auth contract | `POST /api/v1/auth/forgot-password` | Removed | Placeholder route exported into the SDK without a real product flow behind it. |
| Auth contract | `POST /api/v1/auth/callback` | Removed | Deferred OAuth callback surface exported as if live. |
| Participants | type/status/form-trend/mapping-confidence/sport fields | Removed | Promoted to persistence enums where the active domain already treated them as stable closed sets. |
| Root-admin contest surface | admin contest routes, DTOs, and service | Removed | Root-admin no longer carries a parallel contest-ops surface; commissioner paths own contest management for now. |
| Contest persistence | multiple enum-like fields | Deferred To Feature Design | Review during [Plan 88](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/88-contest-creation-and-configuration-user-cases.md), [Plan 89](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/89-contest-entry-and-member-participation-user-cases.md), and [Plan 90](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/90-contest-lifecycle-and-scoring-propagation-user-cases.md) so active runtime values can be separated from deferred catalog debt. |
| JSON-heavy persistence | audit snapshots, ingestion payloads, contest config blobs | Deferred To Feature Design | Audit snapshots and provider payloads are acceptable for now; contest and ingestion model review is explicitly deferred to [Plan 88](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/88-contest-creation-and-configuration-user-cases.md), [Plan 90](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/90-contest-lifecycle-and-scoring-propagation-user-cases.md), and [Plan 91](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/91-sport-data-ingestion-and-contest-update-user-cases.md). |

### Clear Remediation Candidates

#### Persistence enums still stored as broad strings

These appear to be stable closed sets that already have shared-domain enum
support or equivalent active semantics, so they are strong candidates for
cleanup without additional product discovery:

- `League.joinPolicy`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `LeagueMembership.role`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `LeagueMembership.status`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `Squad.status`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `SquadMembership.status`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `LeagueInvitation.inviteType`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- `LeagueInvitation.status`
  - [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)

These are the best first remediation slice because:

- the value sets are already active and reviewed
- the repo already uses shared enums for them
- the semantics are not speculative
- they are tightly connected to the league/member lifecycle work just completed

Status:

- Completed in this audit.

#### Documentation drift with stale auth placeholder language

- [docs/AUTHENTICATION-AUTHORIZATION.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/docs/AUTHENTICATION-AUTHORIZATION.md)
  - still describes admin auth as placeholder header-based behavior, but
    [packages/core-api/src/modules/admin/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/routes.ts)
    now registers the real
    [packages/core-api/src/plugins/admin-auth.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/plugins/admin-auth.ts)
    plugin

This is a clear docs cleanup once the audit stabilizes.

Status:

- Completed in this audit.

#### Participant persistence enum cleanup

Completed in this audit:

- promoted participant-side closed sets to Prisma enums where the active domain
  already treats them as reviewed, stable value catalogs
- aligned persistence for:
  - `Sport.participantType`
  - `Participant.participantType`
  - `Participant.status`
  - `ParticipantSeasonRecord.sport`
  - `ParticipantSeasonRecord.formTrend`
  - `ParticipantProviderMapping.confidence`
- intentionally left `injuryStatus`, `priceTier`, and metadata/external-id JSON
  surfaces alone for later judgment because they are not the same kind of
  closed-set field

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/core-api/prisma/migrations/20260414130000_promote_participant_persistence_enums/migration.sql](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/migrations/20260414130000_promote_participant_persistence_enums/migration.sql)
- [packages/core-api/src/adapters/prisma-participant-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-participant-repository.ts)
- [packages/core-api/src/adapters/prisma-participant-season-record-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-participant-season-record-repository.ts)
- [packages/core-api/src/adapters/prisma-participant-provider-mapping-repository.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/adapters/prisma-participant-provider-mapping-repository.ts)

### Needs Review

#### Candidate field and placeholder-surface removal audit

| Surface | Owner | Why Suspicious | Evidence | Disposition |
|---|---|---|---|---|

This table is intentionally conservative for now. It captures field-level or
contract-level candidates that already have concrete placeholder evidence in
the active code. A broader barely-used/speculative-field scan is in progress
and will extend this table rather than creating a competing list.

## Closure

This cleanup lane is complete for the active service stack review.

What was intentionally deferred:

- contest creation/configuration model review:
  [Plan 88](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/88-contest-creation-and-configuration-user-cases.md)
- contest entry/member participation model review:
  [Plan 89](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/89-contest-entry-and-member-participation-user-cases.md)
- contest lifecycle and scoring propagation model review:
  [Plan 90](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/90-contest-lifecycle-and-scoring-propagation-user-cases.md)
- sport-data ingestion and contest-update model review:
  [Plan 91](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/91-sport-data-ingestion-and-contest-update-user-cases.md)

This plan should not be reopened for those deferred contest/ingestion questions.
Those reviews now belong to the future feature plans above.

The contest stack has many closed-set-looking fields still stored as broad
strings:

- `Contest.status`
- several contest-management/config/pricing fields
- ingestion job/event status fields
- admin action/priority/type fields

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/shared/domain/enums.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/domain/enums.ts)
- [packages/shared/dto/contest-management.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/contest-management.dto.ts)

Needs review because some value catalogs are intentionally broader than the
active v1 runtime, so a persistence-enum pass could accidentally freeze in
deferred values before we confirm the intended steady-state model.

The old root-admin contest surface was removed in this audit, so this review is
now strictly about the core contest and contest-management persistence model,
not a parallel admin DTO layer.

#### JSON payloads that may be honest vs over-broad

Current JSON-heavy areas include:

- audit before/after state
- participant metadata / external IDs / season stats
- contest-management config blobs
- ingestion raw payload / normalized data
- migration options/progress/errors

Representative files:

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/shared/domain/types.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/domain/types.ts)

Some of these are honest flexible payloads; others may be candidates for
future normalization. This needs a narrower review so we do not convert useful
extensibility into premature schema churn.

#### Auth placeholder routes

- [packages/core-api/src/modules/auth/routes.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/auth/routes.ts)
- [packages/core-api/src/modules/auth/handler.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/auth/handler.ts)

`forgot-password` and OAuth callback remain intentionally placeholder/deferred.
Needs review on whether to:

- keep them as documented deferred contract surface
- remove them until implemented
- or implement them properly

#### Root-admin user detail still exposes placeholder-backed fields

- [packages/shared/dto/admin.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/admin.dto.ts)
- [packages/core-api/src/modules/admin/user-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/user-service.ts)

The active user-detail surface still includes:

- `lastLoginAt`
- `devices`
- `recentAuthEvents`

but the service currently returns placeholder or empty values. This should be
either implemented properly or removed from the active contract.

#### Closed-set list persistence needs a convention decision

- [packages/core-api/prisma/schema.prisma](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/prisma/schema.prisma)
- [packages/shared/domain/types.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/domain/types.ts)

`LeagueMembership.permissions` is a closed commissioner-permission set stored
as JSON. This needs an explicit convention decision:

- keep as JSON array
- promote to text array
- or design a stronger enum-array convention

#### Provider-ingestion status mismatch

- [packages/shared/dto/ingestion.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/ingestion.dto.ts)
- [packages/shared/dto/admin.dto.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/shared/dto/admin.dto.ts)
- [packages/core-api/src/modules/admin/provider-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/admin/provider-service.ts)

The ingestion module uses `PENDING`, while the admin provider/dashboard surface
still advertises and queries `QUEUED`. This is an active contract mismatch that
needs review before changing.

#### Deferred UI affordances

- [clients/poolmaster/src/features/leagues/leagues-page.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/poolmaster/src/features/leagues/leagues-page.tsx)
- [clients/poolmaster/src/features/leagues/league-detail-page.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/poolmaster/src/features/leagues/league-detail-page.tsx)
- [clients/poolmaster/src/routes/index.tsx](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/poolmaster/src/routes/index.tsx)

Current UI still includes:

- deferred commissioner messaging hints
- deferred reactivation hints
- generic placeholder page routing

These are not urgent bugs, but they are active scaffolding that should be
either expanded or pruned over time.

### Additional Notes

- [packages/core-api/src/modules/leagues/invitation-service.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/packages/core-api/src/modules/leagues/invitation-service.ts)
  still contains an explicit simplification note about not resolving existing
  member emails during invite skipping. This is real service debt and should be
  cleaned when member directory/user lookup is revisited.

### Candidate New Conventions

- closed-set lists need an explicit persistence convention, not just single-value enums
- placeholder contract fields should be either:
  - explicitly marked deferred in plans/rules
  - or removed from active DTO surface
- superset shared enum catalogs should not automatically flow unchanged into DTOs or persistence when deferred values are intentionally broader than the active runtime
- open-ended operational taxonomies can stay strings when they are intentionally append-only event labels rather than reviewed client-branching enums
