# Plan 80: Backend DTO / Domain Drift Remediation

## Purpose

Audit and remediate drift between the active backend domain model and the
shared request/response DTO surface across PoolMaster.

This plan exists because the repo recently improved backend documentation, but
that exposed a separate class of work: some DTOs and route contracts still
expose stale, missing, or overly broad fields relative to the current domain
truth.

The goal is to keep the active contract surface aligned with the real model,
service behavior, generated OpenAPI, and generated SDK/types before frontend
development continues.

## Status

Active.

## Why This Exists

The backend contract cleanup that preceded frontend planning was not a full
model-to-DTO alignment sweep.

Two concrete examples already confirmed in the audit:

1. A league-related admin DTO still exposes `sport` even though the `League`
   domain entity does not have a `sport` property and the admin user-service is
   filling that field with a placeholder empty string.
2. `UpdateLeagueRequestSchema` is still exported from the league DTO module even
   though the active league routes do not use it. That is stale contract surface
   and should either be removed or replaced with a real route-backed request
   model if a metadata-update route is intentionally reintroduced.

The repository needs a broader sweep so we do not keep rediscovering stale DTO
surface feature-by-feature.

## Confirmed Drift Findings

### D-001: League admin detail still exposes a stale `sport` field

- `packages/shared/dto/admin.dto.ts`
  - `UserLeagueDetailDtoSchema` includes `sport`
- `packages/core-api/src/modules/admin/user-service.ts`
  - the user detail projection populates `sport: ''` for league rows
- `packages/shared/domain/types.ts`
  - the active `League` domain entity has no `sport` field

Impact:
- the admin user detail DTO exposes a stale league-shaped field that no longer
  exists in the domain model
- the empty-string placeholder is effectively invented data and should not be
  part of the active contract
- generated OpenAPI/SDK output currently inherits this drift

### D-002: `UpdateLeagueRequestSchema` is orphaned from active league routes

- `packages/shared/dto/leagues.dto.ts`
  - `UpdateLeagueRequestSchema` is exported
- `packages/core-api/src/modules/leagues/routes.ts`
  - the active league routes only expose `updateSettings`, not a metadata update
    route using `UpdateLeagueRequestSchema`
- search in the codebase shows no active service/handler path consuming that
  request schema

Impact:
- the shared contract surface includes a request shape that is not actually
  wired to a route
- this creates unnecessary contract surface area and makes the generated SDK
  broader than the active behavior
- it is not clear whether the intended fix is removal or reintroduction via a
  real route; the plan needs to resolve that intentionally

### D-003: History season summary DTOs are exported without an active route-backed consumer

- `packages/shared/dto/history.dto.ts`
  - `HistorySeasonSummaryDtoSchema` and `HistorySeasonsResponseSchema` are
    exported
- `packages/core-api/src/modules/history/routes.ts`
  - the active history module only exposes contest history summary/standings,
    roster history, payouts, and league/member results
  - there is no active route consuming the season-summary response schema

Impact:
- the shared contract surface exposes a history-season payload family that is
  not wired to any active backend route
- generated OpenAPI/SDK output likely includes a surface that the backend does
  not currently serve
- this should either be removed from the active contract surface or tied to a
  real route as part of a deliberate feature decision

### D-004: League request and response DTOs still type enum-backed fields as generic strings

- `packages/shared/dto/leagues.dto.ts`
  - several request and response fields were still declared as plain strings
    even though the active domain already constrains them to shared enums
- `packages/shared/domain/enums.ts`
  - the active domain already defines `LeagueVisibility`, `LeagueRole`,
    `LeagueMembershipStatus`, `InvitePolicy`, `InviteType`, and
    `InvitationStatus`

Impact:
- generated OpenAPI and generated SDK/types were broader than the real domain
  behavior for league and invitation surfaces
- frontend consumers could not rely on the exported contract to understand the
  allowed values for these fields
- backend implementation code was still carrying a few generic-string
  assumptions in member-management paths

### D-005: Contest summary/detail DTOs still type enum-backed fields as generic strings

- `packages/shared/dto/contests.dto.ts`
  - contest response fields for `status`, `contestType`, `selectionType`, and
    `scoringEngine` were still exported as plain strings
- `packages/shared/domain/types.ts`
  - the active contest domain already constrains those fields to
    `ContestStatus`, `ContestType`, `SelectionType`, and `ScoringEngine`

Impact:
- generated OpenAPI and generated SDK/types were looser than the real contest
  domain
- frontend consumers could not use the generated contract to discover valid
  contest lifecycle and configuration values
- backend mapper and service call sites still contained a few generic-string
  assumptions for contest entry projection

### D-006: Participant response DTOs still type enum-backed fields as generic strings

- `packages/shared/dto/participants.dto.ts`
  - participant response fields for `participantType`, `status`, injury
    `status`, season-record `sport`, and `formTrend` were still exported as
    generic strings
- `packages/shared/domain/types.ts`
  - the active participant domain already constrains those fields to shared
    enums such as `ParticipantType`, `ParticipantStatus`, `InjuryStatusCode`,
    `Sport`, and `FormTrend`

Impact:
- generated OpenAPI and generated SDK/types were broader than the real
  participant domain
- frontend consumers could not rely on the exported participant contract to
  discover the valid enum values for draft-search and participant-detail
  surfaces

## Remaining Audit Findings

These findings are confirmed enough to guide the next sequential remediation
slices, but they have not all been implemented yet.

### D-007: Draft response DTOs still type enum-backed state fields as generic strings

- `packages/shared/dto/drafts.dto.ts`
  - `DraftStateDtoSchema`, `DraftStateResponseSchema`, and
    `DraftPickResponseSchema` still export `selectionType` and `status` as plain
    strings
- `packages/shared/domain/enums.ts`
  - the active draft and contest domain already constrains those fields to
    `SelectionType` and `DraftStatus`
- `packages/core-api/src/mappers/drafts.mapper.ts`
  - the draft mapper already carries `DraftStatus` in its session/state inputs
- `packages/core-api/src/modules/drafts/routes.ts`
  - route logic already imports and uses `DraftStatus` and `SelectionType`

Recommended fix:
- narrow draft DTO `selectionType` to `SelectionType`
- narrow draft DTO `status` to `DraftStatus`
- align any remaining draft mapper helper interfaces that still surface `string`
  instead of the shared enum type

Isolation:
- yes, this looks like a clean sequential slice centered on the draft contract
  family

### A-001/A-002/A-004: Root-admin user and contest DTOs still expose overbroad role/status/type fields

- `packages/shared/dto/admin.dto.ts`
  - `UserLeagueMembershipSummaryDtoSchema.role` and
    `UserLeagueDetailDtoSchema.role` are still plain strings
  - `UserContestDetailDtoSchema.status` is still a plain string
  - `ContestListItemDtoSchema` and `ContestAdminDetailResponseSchema` still
    export contest `contestType`, `selectionType`, `scoringEngine`, and
    `status` as plain strings
  - `ContestDraftStatusDtoSchema.status` is still a plain string
- `packages/core-api/src/modules/admin/user-service.ts`
  - user-league role and contest status values are currently transformed to
    lowercase strings, so the admin contract needs explicit lowercase unions if
    that behavior is intentional
- `packages/core-api/src/modules/admin/contest-service.ts`
  - admin contest detail/list paths already pull constrained contest and draft
    status values from the active backend model, but still expose them through
    overly broad DTO fields

Recommended fix:
- split admin remediation into two slices:
  - admin user detail/list role and contest-status unions
  - admin contest list/detail and draft-status unions
- decide explicitly whether lowercase admin role/status strings are intentional;
  if yes, narrow them to explicit lowercase unions instead of leaving them as
  generic strings

Isolation:
- partial; admin user and admin contest surfaces are each isolated enough for
  separate sequential slices

### D-010: Event summary DTO still exports constrained sport and status fields as generic strings

- `packages/shared/dto/events.dto.ts`
  - `EventSummaryDtoSchema.sport` and `EventSummaryDtoSchema.status` are still
    plain strings
- `packages/core-api/src/modules/ingestion/core/provider-interface.ts`
  - the active event provider interface already constrains `sport` to `Sport`
    and `status` to the event lifecycle union
    `SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED | POSTPONED`
- `packages/core-api/src/mappers/events.mapper.ts`
  - the event mapper still types both fields as generic strings

Recommended fix:
- narrow event DTO `sport` to the shared `Sport` enum
- narrow event DTO `status` to the provider-event status union
- align the event mapper interface to those constrained values

Isolation:
- yes, this looks like a small, isolated sequential slice

### D-011: Scoring health response exports a route-stable status as a generic string

- `packages/shared/dto/scoring.dto.ts`
  - `ScoringHealthResponseSchema.status` is still a plain string
- `packages/core-api/src/modules/scoring/service.ts`
  - scoring health currently returns `status: 'ok'`

Recommended fix:
- narrow the scoring health `status` field to a literal `ok` if that route is
  intentionally stable at the moment, or introduce an explicit health union if
  more states are expected soon

Isolation:
- yes, this is a very small DTO-only slice

### D-012/D-013: Config DTO surface still appears misaligned with the active route payload

- `packages/shared/dto/config.dto.ts`
  - `SportConfigDto` still exports enum-backed `name` and `participantType`
    fields as generic strings
  - `PlatformConfigResponseSchema` advertises a platform-bootstrap payload with
    `sports` and `features`
- `packages/core-api/src/modules/config/routes.ts`
  - the active `/api/v1/config/poll-intervals` route currently returns
    `POLL_INTERVAL_CONFIG`, not the `PlatformConfigResponseSchema` payload

Recommended fix:
- resolve the route contract first:
  - either return actual platform configuration that matches the current DTO, or
  - change the route schema to the real poll-interval payload
- only then tighten the remaining config DTO enum-backed fields

Isolation:
- no; this is a broader contract mismatch, not just enum narrowing

### D-014: Ingestion provider and job DTOs still export sport-backed fields as generic strings

- `packages/shared/dto/ingestion.dto.ts`
  - `IngestionProviderSummaryDtoSchema.sportsCovered`
  - `IngestionJobRecordDtoSchema.sport`
  - `IngestSportOddsResponseSchema.sport`
  - all still use generic strings
- `packages/core-api/src/modules/ingestion/core/provider-interface.ts`
  - the active ingestion-provider contract already constrains `sportsCovered`
    and event/job sport values to `Sport`
- `packages/core-api/src/modules/ingestion/routes.ts`
  - active ingestion routes return provider `sportsCovered` and odds `sport`
    directly from the typed provider and request flow

Recommended fix:
- narrow the ingestion DTO sport surfaces to the shared `Sport` enum
- keep the job lifecycle `status` field as-is, since it is already explicitly
  constrained

Isolation:
- yes; this is a clean ingestion-contract slice

## Parallel Audit Findings

This section captures domain-family audit findings that are ready to be turned
into the next sequential remediation slices.

### Drafts

#### D-007: Draft response DTOs export enum-backed `selectionType` and `status` as generic strings

- `packages/shared/dto/drafts.dto.ts`
  - `DraftStateDtoSchema`, `DraftStateResponseSchema`, and
    `DraftPickResponseSchema` type `selectionType` and `status` as plain
    strings
- `packages/core-api/src/modules/drafts/routes.ts`
  - active draft routes populate those fields from the contest selection type
    and derived draft status
- the active domain already constrains these values to `SelectionType` and
  `DraftStatus`

Recommended fix:
- narrow draft response schemas to the shared enum unions for
  `selectionType` and `status`
- tighten route-local draft/contest helper types in the draft routes so they
  stop pretending those values are unconstrained strings

Isolation:
- yes; this is a clean draft-contract slice

#### D-008: `DraftStateDtoSchema` appears to be an orphaned duplicate surface

- `packages/shared/dto/drafts.dto.ts`
  - `DraftStateDtoSchema` and `DraftStateDto` are exported
- the active route surface uses:
  - `DraftStateResponseSchema`
  - `DraftPickResponseSchema`
- search did not find an active consumer for `DraftStateDtoSchema`

Recommended fix:
- remove the orphaned schema if it is intentionally unused, or
- refactor the draft response schemas to extend a shared base instead of
  keeping an extra exported duplicate

Isolation:
- yes; DTO-module-only cleanup

#### D-009: The draft mapper still carries stale broad local types

- `packages/core-api/src/mappers/drafts.mapper.ts`
  - local response types still include broad string status typing even though
    the file already imports `DraftStatus`
- active draft responses are built directly in the draft routes, not through
  this mapper

Recommended fix:
- either remove the orphaned mapper if it is dead code, or
- narrow its local interfaces to the real domain enums if we keep it

Isolation:
- yes, but secondary after `D-007`

### Root-Admin Backend Surface

These findings refer to the still-active root-admin API surface under
`/api/v1/admin/*`, not to a separate admin app/client.

#### A-001: Root-admin user league-role DTOs still drift from the real domain values

- `packages/shared/dto/admin.dto.ts`
  - `UserLeagueMembershipSummaryDtoSchema.role`
  - `UserLeagueDetailDtoSchema.role`
  - both are plain strings
- `packages/core-api/src/modules/admin/user-service.ts`
  - lowercases persisted league roles before returning them
- the source domain field is `LeagueMembership.role: LeagueRole`

Recommended fix:
- narrow both DTO role fields to shared `LeagueRole` values
- stop lowercasing league roles in the root-admin user service

Isolation:
- yes; small root-admin user slice

#### A-002: Root-admin contest DTOs still export enum-backed contest fields as generic strings

- `packages/shared/dto/admin.dto.ts`
  - root-admin contest list/detail DTOs still export:
    - `contestType`
    - `selectionType`
    - `scoringEngine`
    - `status`
    as plain strings
- `packages/core-api/src/modules/admin/contest-service.ts`
  - lowercases contest status before returning it
- the active contest domain already constrains those fields to shared enums

Recommended fix:
- narrow the root-admin contest DTO fields to the same shared contest enums
  where the semantics match
- stop lowercasing emitted contest status
- if root-admin needs a separate vocabulary, define it explicitly rather than
  using `string`

Isolation:
- mostly yes; coherent root-admin contest slice

#### A-003: `forceCloseContest()` currently uses `CLOSED`, which is not an active contest domain status

- `packages/core-api/src/modules/admin/contest-service.ts`
  - `forceCloseContest()` writes `status: 'CLOSED'`
- the active contest domain enum does not include `CLOSED`
  - it uses values such as `COMPLETED` and `CANCELLED`
- the broad root-admin DTO status typing currently hides that mismatch

Recommended fix:
- resolve the semantic choice intentionally:
  - map force-close to an existing contest domain status, or
  - extend the domain model if `CLOSED` is truly required
- only after that should the related root-admin contest DTO status be narrowed

Isolation:
- no; this is a real behavior/domain decision, not just DTO tightening

Status update:
- resolved by reusing the commissioner lifecycle semantics: root-admin
  force-close now maps to `COMPLETED`, and reopen continues to map to `ACTIVE`

#### A-004: Root-admin user contest detail status is still too broad

- `packages/shared/dto/admin.dto.ts`
  - `UserContestDetailDtoSchema.status` is a generic string
- `packages/core-api/src/modules/admin/user-service.ts`
  - lowercases contest status before returning it
- the backing contest domain already has constrained status values

Recommended fix:
- narrow the field to the shared contest-status enum, or to an explicit
  root-admin contest-status enum if semantics differ
- stop lowercasing unless we intentionally introduce that separate enum

Isolation:
- yes, especially if handled together with `A-002`

### Remaining Smaller DTO Families

#### D-010: Event summary DTOs still export constrained sport and status values as generic strings

- `packages/shared/dto/events.dto.ts`
  - `sport` and `status` are generic strings
- `packages/core-api/src/mappers/events.mapper.ts`
- `packages/core-api/src/modules/ingestion/core/provider-interface.ts`
  - the active ingestion/event contract already constrains:
    - `sport` to `Sport`
    - `status` to the current event-status union used by providers

Recommended fix:
- narrow `sport` to the shared `Sport` enum
- narrow `status` to the real event-status union
- align mapper/interface types to match

Isolation:
- yes; clean event-contract slice

#### D-011: Scoring health response still exports a fixed status as a generic string

- `packages/shared/dto/scoring.dto.ts`
  - `ScoringHealthResponse.status` is a generic string
- `packages/core-api/src/modules/scoring/service.ts`
  - the service currently returns a fixed `'ok'` value

Recommended fix:
- narrow the field to a literal `'ok'` or a tiny explicit health union if
  future expansion is intended
- align the scoring service helper type to match

Isolation:
- yes; small scoring-contract slice

#### D-012: `SportConfigDto` still exports enum-backed fields as generic strings

- `packages/shared/dto/config.dto.ts`
  - `SportConfigDto.name`
  - `SportConfigDto.participantType`
  - both are generic strings
- `packages/shared/domain/types.ts`
  - `SportConfig` already constrains those fields to `Sport` and
    `ParticipantType`

Recommended fix:
- if this DTO remains active, narrow both fields to the shared enums

Isolation:
- not yet; this is blocked by the larger config-surface mismatch below

#### D-013: The active config route appears to advertise the wrong response schema

- `packages/core-api/src/modules/config/routes.ts`
- `packages/shared/dto/config.dto.ts`
  - the active config route advertises `PlatformConfigResponseSchema`
  - but the handler currently returns `POLL_INTERVAL_CONFIG`

Recommended fix:
- resolve the route contract first:
  - either return actual platform config, or
  - change the route schema to the real poll-interval payload
- only then tighten any remaining config DTO enums

Isolation:
- no; this is broader contract drift, not just enum narrowing

Status update:
- completed by replacing the stale platform-bootstrap DTO surface with shared
  poll-interval config schemas and wiring both the public config route and the
  root-admin poll-config routes to that truthful contract family

#### D-014: Ingestion provider and job DTOs still export sport-backed fields as generic strings

- `packages/shared/dto/ingestion.dto.ts`
  - provider `sportsCovered`
  - job `sport`
  - odds response `sport`
  - all are still generic strings
- `packages/core-api/src/modules/ingestion/core/provider-interface.ts`
  - the active provider interface already constrains covered sports to `Sport[]`
    and event/job sport values to `Sport`
- `packages/core-api/src/modules/ingestion/routes.ts`
  - the active routes return those sport values directly from the typed provider
    registry and request flow

Recommended fix:
- narrow ingestion provider and job sport fields to the shared `Sport` enum
- keep the ingestion job lifecycle status as-is because it is already an
  explicit enum

Isolation:
- yes; clean ingestion-contract slice

#### A-005: Root-admin provider DTOs still export sport-backed fields as generic strings

- `packages/shared/dto/admin.dto.ts`
  - `ProviderSummaryDtoSchema.sportsCovered`
  - `ProviderIngestionStatDtoSchema.sport`
  - `ProviderIngestionJobDtoSchema.sport`
  - `ProviderUnmappedParticipantDtoSchema.sport`
  - all are still generic strings
- `packages/core-api/src/modules/admin/provider-service.ts`
  - the root-admin provider service currently converts provider sports to
    strings with `map(String)` even though the backing provider interface uses
    `Sport[]`

Recommended fix:
- narrow the root-admin provider DTO sport fields to the shared `Sport` enum
- stop stringifying provider sport values in the root-admin provider service

Isolation:
- yes; coherent root-admin provider slice

### Verified Stable Families

The following active DTO families were re-reviewed during the full backend audit
and do not currently show confirmed DTO-to-domain drift that should be remediated
under Plan 80:

- `packages/shared/dto/auth.dto.ts`
  - active auth request and response fields are aligned with the current
    service/domain behavior
- `packages/shared/dto/account-consent.dto.ts`
  - `consentType` remains broad, but the current service and persistence model
    are also broad; there is no confirmed shared enum drift yet
- `packages/shared/dto/notifications.dto.ts`
  - notification event/category strings are still intentionally broad in the
    active mapper and route flow
- `packages/shared/dto/squads.dto.ts`
  - squad status and membership status are already exported as explicit unions
- `packages/shared/dto/standings.dto.ts`
  - standings movement and related fields are already exported as explicit
    unions where the active route behavior constrains them
- `packages/shared/dto/contest-management.dto.ts`
  - the remaining string-backed fields such as `autoPickPolicy` and
    `pricingMethod` currently match the domain model, which is also still broad

## Broader Backend Drift And Dead-Code Findings

These findings go beyond DTO shape drift, but they are directly adjacent to the
same cleanup effort because they create confusion about which backend surfaces
are actually authoritative.

### X-001: Draft mapper appears to be dead or redundant alongside the active draft routes

- `packages/core-api/src/mappers/drafts.mapper.ts`
  - exports `toDraftStateResponse`, `toDraftPickHistoryDto`, and local draft
    response interfaces
- search did not find any active route or service consumer of those exports
- `packages/core-api/src/modules/drafts/routes.ts`
  - builds the active draft responses directly instead of using the mapper
- `packages/core-api/src/mappers/index.ts`
  - still re-exports the draft mapper, which makes the dead surface look active

Recommended fix:
- decide whether the draft mapper should:
  - be removed entirely as dead code, or
  - become the single shared response builder used by the draft routes
- do not keep both patterns active

Isolation:
- yes; clean draft-module cleanup slice

Status update:
- resolved by removing the unused draft mapper and its barrel export; the draft
  routes remain the single active response-building path

### X-002: Admin audit functionality is split across two overlapping service layers

- `packages/core-api/src/modules/admin/admin-audit-service.ts`
  - owns audit logging and still exports `listAuditEntries`
- `packages/core-api/src/modules/admin/audit-query-service.ts`
  - separately owns audit-query read paths used by the active handlers
- `packages/core-api/src/modules/admin/audit-handler.ts`
  - reads only from `audit-query-service`
- search did not find an active consumer of
  `admin-audit-service.listAuditEntries`

Recommended fix:
- keep one authoritative read/query path for admin audit entries
- either remove `listAuditEntries` from `admin-audit-service` or consolidate the
  read/query implementation so the split is intentional and obvious

Isolation:
- yes; root-admin audit cleanup slice

Status update:
- resolved by removing the unused `listAuditEntries` read surface from the
  write-side audit service; `audit-query-service` remains the single
  authoritative read path

### X-003: Root-admin platform config has two competing sources of truth

- `packages/core-api/src/modules/config/routes.ts`
  - serves public `/api/v1/config/poll-intervals` from `POLL_INTERVAL_CONFIG`
- `packages/core-api/src/modules/admin/poll-config-service.ts`
  - separately owns root-admin poll-config behavior
- `packages/core-api/src/modules/admin/platform-config-routes.ts`
  - also participates in admin/platform configuration behavior

Recommended fix:
- document and simplify the intended ownership:
  - public runtime poll intervals
  - root-admin poll-config management
  - broader platform config
- remove or consolidate redundant helpers once the config contract mismatch
  (`D-012/D-013`) is resolved

Isolation:
- partial; this is a small architecture cleanup rather than a one-file deletion

## Audit Scope

In scope:

- active domain entities in `packages/shared/domain/`
- request/response DTOs in `packages/shared/dto/`
- route schemas in active backend modules
- mapper output that feeds response DTOs
- generated OpenAPI / SDK / TS types that inherit from the above
- all active backend surfaces, not just leagues
- overbroad string-typed fields that should be narrowed to existing shared
  enums or explicit unions where the domain already constrains the values

Out of scope:

- changing frontend implementation before the backend contract is cleaned up
- introducing new product features unrelated to contract drift
- refactoring retired or archived feature surfaces unless they are still part of
  the active generated contract

## Remediation Strategy

1. Audit the active domain-model-to-DTO pairs across backend modules.
2. Classify each mismatch as one of:
   - stale field that should be removed
   - missing field that should be added
   - overly broad contract surface that should be narrowed
   - computed field that should remain but be documented as derived
3. Update DTOs, route schemas, mappers, and services together.
4. Regenerate OpenAPI and generated client/types after each aligned slice.
5. Re-run the relevant backend validation gates to confirm the contract and the
   implementation still match.
6. When a slice changes shared DTOs, generated types, or exported enums, also
   run the downstream consumer checks before push:
   - `npx turbo typecheck --filter=@poolmaster/shared --filter=@poolmaster/core-api --filter=@poolmaster/poolmaster --force`
   - `npx eslint 'packages/*/src/**/*.ts' 'clients/poolmaster/src/**/*.{ts,tsx}' 'clients/poolmaster/e2e/**/*.ts' --max-warnings 0`
   This is required even for "backend-first" slices because the first Plan 80
   remediation pushes broke the PoolMaster consumer package at typecheck time.

## Remediation Checklist

| ID | Phase | Task | Status | Notes |
| --- | --- | --- | --- | --- |
| 80-001 | 1 | Inventory the active domain entities and DTO families that still matter to the frontend-facing contract | Done | Initial audit already covered leagues, contests, participants, admin, events, and history surfaces. |
| 80-002 | 1 | Confirm and document concrete DTO/domain drift findings | Done | `UserLeagueDetailDtoSchema.sport` and orphaned `UpdateLeagueRequestSchema` are confirmed issues. |
| 80-003 | 1 | Sweep all active request/response DTOs for stale or placeholder fields | In Progress | First cleanup slice removes the stale admin league `sport` field and the orphaned history season DTO surface. |
| 80-004 | 1 | Sweep all route schemas and handlers for request models that are exported but not actually wired to active routes | In Progress | First cleanup slice removes the orphaned `UpdateLeagueRequestSchema`. |
| 80-005 | 1 | Sweep mapper/service outputs for placeholder values that exist only to satisfy stale DTOs | In Progress | First cleanup slice removes the admin user-detail `sport: ''` placeholder. |
| 80-006 | 1 | Regenerate OpenAPI and SDK/types after each contract-aligned change set | In Progress | First cleanup slice already refreshed OpenAPI and generated types after removing stale admin/history/league DTO surface. |
| 80-007 | 1 | Re-run backend validation gates after each aligned slice | In Progress | Backend slices must still prove downstream consumer safety when shared DTOs/enums change; early Plan 80 pushes failed `@poolmaster/poolmaster` typecheck because that consumer gate was skipped locally. |
| 80-008 | 1 | Decide whether orphaned request schemas should be removed or reintroduced behind real routes | Not Started | This is the key decision point for `UpdateLeagueRequestSchema` and any similar drift found during the sweep. |
| 80-009 | 1 | Audit overbroad scalar fields and tighten them to the real domain enums/unions where appropriate | In Progress | Second cleanup slice narrowed league and invitation enum-backed DTO fields. Third cleanup slice narrowed contest summary/detail enum-backed fields. Fourth cleanup slice narrowed participant response enum-backed fields for participant detail and draft-search surfaces. |
| 80-010 | 2 | Remove or consolidate backend dead code that duplicates active contract-building paths | In Progress | `X-001` draft mapper cleanup and `X-002` audit read-surface cleanup are resolved; remaining dead-code cleanup is limited and may collapse into the final review. |
| 80-011 | 2 | Resolve backend modules that still have competing sources of truth after contract cleanup | In Progress | Config/poll contract drift is now aligned to shared poll-interval schemas; remaining work is deciding whether any broader platform-bootstrap config surface still belongs in the backend at all. |
| 80-012 | 3 | Review and update non-API backend documentation and rules after the drift cleanup lands | Not Started | Final pass should cover backend-facing docs and repo rules outside generated API artifacts so architecture, workflow, and implementation guidance match the cleaned backend. |
| 80-013 | 1 | Add and follow a Plan 80 pre-push gate that includes downstream PoolMaster consumer checks | Done | Added after CI failures on early slices showed that shared-contract changes must run PoolMaster typecheck/lint before push, not just backend-only gates. |

## Relationship To Other Plans

- [plans/75-league-creation-wizard-discovery.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/75-league-creation-wizard-discovery.md)
  should only proceed against a cleaned league-create contract.
- [plans/78-backend-contract-documentation-hardening.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/archive/2026-04-backend-completion/78-backend-contract-documentation-hardening.md)
  improved contract documentation quality, but this plan handles the separate
  stale-field / drift-removal work that documentation alone does not solve.

## Notes

- The current branch already remediated one high-signal drift slice:
  - `CreateLeagueRequestSchema` was cleaned so it now requires the explicit
    `leagueCode` field and no longer exposes stale create-league inputs.
  - The plan remains open because the repo still needs the broader
    domain-to-DTO audit beyond leagues.
- Additional validated remediation slices now include:
  - removal of stale admin/history/orphaned league DTO surface
  - narrowing of league and invitation enum-backed fields so the generated
    contract matches the active domain enums more closely
  - narrowing of draft response enums plus event sport/status and scoring
    health status fields so generated consumers track the active backend values
  - narrowing ingestion provider/job/odds sport fields so operational surfaces
    export the shared `Sport` enum instead of loose strings
  - narrowing root-admin provider sport fields so admin ingestion tooling uses
    the same shared `Sport` enum instead of stringified provider values
- Removing a property from the active contract means removing it from:
  - DTOs
  - route schemas
  - mapper/service outputs
  - generated OpenAPI
  - generated SDK/types
- A field that is only present as a placeholder to satisfy an outdated DTO is a
  contract bug, not acceptable documentation.
- This plan applies repo-wide to active backend surfaces, not just leagues.
