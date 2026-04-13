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

## Remediation Checklist

| ID | Phase | Task | Status | Notes |
| --- | --- | --- | --- | --- |
| 80-001 | 1 | Inventory the active domain entities and DTO families that still matter to the frontend-facing contract | Done | Initial audit already covered leagues, contests, participants, admin, events, and history surfaces. |
| 80-002 | 1 | Confirm and document concrete DTO/domain drift findings | Done | `UserLeagueDetailDtoSchema.sport` and orphaned `UpdateLeagueRequestSchema` are confirmed issues. |
| 80-003 | 1 | Sweep all active request/response DTOs for stale or placeholder fields | Not Started | Includes league, admin, contest, participant, history, events, ingestion, and other currently active backend contract areas. |
| 80-004 | 1 | Sweep all route schemas and handlers for request models that are exported but not actually wired to active routes | Not Started | Remove or intentionally reintroduce orphaned request shapes as part of a real route-backed behavior. |
| 80-005 | 1 | Sweep mapper/service outputs for placeholder values that exist only to satisfy stale DTOs | Not Started | Example already found: `sport: ''` in admin user detail. |
| 80-006 | 1 | Regenerate OpenAPI and SDK/types after each contract-aligned change set | Not Started | The generated artifacts must match the cleaned DTO surface. |
| 80-007 | 1 | Re-run backend validation gates after each aligned slice | Not Started | Typecheck, lint, and service coverage gates should confirm the cleanup did not break the backend. |
| 80-008 | 1 | Decide whether orphaned request schemas should be removed or reintroduced behind real routes | Not Started | This is the key decision point for `UpdateLeagueRequestSchema` and any similar drift found during the sweep. |
| 80-009 | 1 | Audit overbroad scalar fields and tighten them to the real domain enums/unions where appropriate | Not Started | Examples include contract fields that are still typed as plain strings even though the domain model already has a constrained enum. |

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
- Removing a property from the active contract means removing it from:
  - DTOs
  - route schemas
  - mapper/service outputs
  - generated OpenAPI
  - generated SDK/types
- A field that is only present as a placeholder to satisfy an outdated DTO is a
  contract bug, not acceptable documentation.
- This plan applies repo-wide to active backend surfaces, not just leagues.
