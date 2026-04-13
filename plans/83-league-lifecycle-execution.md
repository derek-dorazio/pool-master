## Objective

Implement the backend and frontend work for commissioner-managed league
lifecycle:

- inactivate league
- delete inactive league with full cascade cleanup

## Dependencies

- [82-league-lifecycle-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/82-league-lifecycle-user-cases.md)
- [76-league-home-and-league-context-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/76-league-home-and-league-context-user-cases.md)

## Backend Deliverables

- commissioner API to inactivate a league
- commissioner API to delete an inactive league
- `leagueCode` confirmation on delete
- cascade delete service for league-owned data
- contract docs + DTO/OpenAPI regeneration
- backend tests proving inactive-first and cascade correctness

## Frontend Deliverables

- league management surface for inactivate
- destructive delete flow only for inactive league
- irreversible warning dialog
- typed `leagueCode` confirmation
- post-delete navigation back to non-league context

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 83-001 | 1 | Data-modeler review of current league lifecycle surface and exact delete cascade scope | Done | No required Prisma/schema change for the first slice. Use existing `league.settings.isActive` for inactivation. Backend work is API/service/cascade-focused. Confirmed cascade scope includes memberships, invitations, squads and squad memberships, contests and contest-owned descendants, commissioner action items, commissioner audit log, and other league-owned rows while preserving user accounts. |
| 83-002 | 1 | Backend developer: add commissioner league-inactivate API contract and service behavior | Done | Added explicit commissioner inactivate route, OpenAPI docs, DTO export, service behavior, and handler wiring. |
| 83-003 | 1 | Backend developer: add commissioner inactive-league delete API with `leagueCode` confirmation | Done | Added inactive-only delete route with typed `leagueCode` confirmation and stable error codes for active-league delete and confirmation mismatch. |
| 83-004 | 1 | Backend developer: implement league cascade-delete service | Done | Implemented transaction-safe deletion of league-owned memberships, invitations, squads, contests and contest-owned descendants, commissioner action items, and commissioner audit log while preserving users. |
| 83-005 | 1 | Backend developer: add backend validation and contract coverage | Done | Regenerated OpenAPI and Hey API artifacts. Passed shared/core/poolmaster typecheck, eslint, PoolMaster vitest/build, unit/integration/functional backend coverage, and contract verification. |
| 83-006 | 2 | Frontend developer: add league management UI for inactivate action | Not Started | Commissioner-facing, prominent safe action |
| 83-007 | 2 | Frontend developer: add inactive-league delete UX | Not Started | Warning dialog, typed `leagueCode` confirmation, disabled until inactive |
| 83-008 | 2 | Frontend developer: add post-delete routing and truthful empty-state behavior | Not Started | Route user back to `/welcome` or equivalent |
| 83-009 | 2 | Frontend developer: add UI tests and extend browser journey planning hooks | Not Started | Keep browser proof aligned with real lifecycle once available |

## Data-Modeler Review Notes

- Current league inactivation can be implemented without a schema migration.
  The active domain already persists league activity via
  `league.settings.isActive`, and that flag is already surfaced in DTOs,
  mappers, and the PoolMaster UI.
- The first lifecycle slice should therefore remain contract/service-focused:
  commissioner routes, service behavior, delete-confirmation contract, and
  cascade-delete orchestration.
- Permanent league delete also does not require a schema change for the first
  slice. It does require a transaction-safe cascade service that removes
  league-owned data while preserving user accounts.
- If we later want a richer first-class lifecycle state such as
  `League.status`, that would be a future model change rather than a blocker
  for this plan.
