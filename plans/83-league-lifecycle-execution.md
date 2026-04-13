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
| 83-001 | 1 | Data-modeler review of current league lifecycle surface and exact delete cascade scope | Not Started | Confirm all league-owned tables and relationships that must be deleted |
| 83-002 | 1 | Backend developer: add commissioner league-inactivate API contract and service behavior | Not Started | DTOs, route docs, service logic, mapper/handler updates |
| 83-003 | 1 | Backend developer: add commissioner inactive-league delete API with `leagueCode` confirmation | Not Started | Reject active-league delete; require exact confirmation match |
| 83-004 | 1 | Backend developer: implement league cascade-delete service | Not Started | Delete league-owned rows/relationships, preserve users |
| 83-005 | 1 | Backend developer: add backend validation and contract coverage | Not Started | Unit, integration, functional API, contract verification, API regen |
| 83-006 | 2 | Frontend developer: add league management UI for inactivate action | Not Started | Commissioner-facing, prominent safe action |
| 83-007 | 2 | Frontend developer: add inactive-league delete UX | Not Started | Warning dialog, typed `leagueCode` confirmation, disabled until inactive |
| 83-008 | 2 | Frontend developer: add post-delete routing and truthful empty-state behavior | Not Started | Route user back to `/welcome` or equivalent |
| 83-009 | 2 | Frontend developer: add UI tests and extend browser journey planning hooks | Not Started | Keep browser proof aligned with real lifecycle once available |

