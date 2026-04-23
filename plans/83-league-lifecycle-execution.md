## Objective

Implement the backend and frontend work for commissioner-managed league
lifecycle:

- inactivate league
- delete inactive league with full cascade cleanup

## Dependencies

- [82-league-lifecycle-user-cases.md](./82-league-lifecycle-user-cases.md)
- [76-league-home-and-league-context-user-cases.md](./76-league-home-and-league-context-user-cases.md)

## Backend Deliverables

- commissioner API to inactivate a league
- commissioner API to delete an inactive league
- `leagueCode` confirmation on delete
- cascade delete service for league-owned data
- contract docs + DTO/OpenAPI regeneration
- backend tests proving inactive-first and cascade correctness

## Frontend Deliverables

- manage-league modal launched from league-list tiles
- initial management shell that can grow into details/icon/settings/lifecycle
  tabs
- league lifecycle tab for inactivate
- destructive delete flow only for inactive league
- inline irreversible delete mini-wizard
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
| 83-006 | 2 | Frontend developer: add `Manage League` entry point from league tiles | Done | Commissioner league tiles now expose `Manage league`, which launches the management modal from the existing tile-based leagues list. |
| 83-007 | 2 | Frontend developer: add manage-league modal shell with future tab scaffolding | Done | Added modal shell with `Details`, `Icon`, `Settings`, and `Lifecycle` sections so future commissioner settings work can grow in place. |
| 83-008 | 2 | Frontend developer: implement lifecycle tab with inactivate action | Done | Lifecycle tab now calls the commissioner inactivate API and refreshes the leagues overview after success. |
| 83-009 | 2 | Frontend developer: add inactive-league delete mini-wizard UX | Done | Added inline delete flow with irreversible warning, typed `leagueCode` confirmation, disabled delete until exact match, and post-delete success state. |
| 83-010 | 2 | Frontend developer: add post-delete routing and truthful empty-state behavior | Done | Deletion refreshes the leagues query; when no leagues remain, the existing list route truthfully returns the commissioner to `/welcome`. |
| 83-011 | 2 | Frontend developer: add UI tests and extend browser journey planning hooks | Done | Added modal UI tests covering inactivate and delete behavior. Browser expansion remains intentionally deferred under Plan 86 until lifecycle/account cleanup flows are complete. |
| 83-012 | 3 | Data-modeler: remediate league lifecycle model drift by promoting first-class fields and removing `League.settings` | Done | Locked the simplified league model: `League.isActive` and `League.joinPolicy` are first-class fields, speculative settings were retired, and the old JSON settings bag is no longer part of the approved design. |
| 83-013 | 3 | Backend developer: update league persistence, contract, and tests to match the simplified model | Done | Added schema migration, repository/service cleanup, DTO/OpenAPI regeneration, removed the stale settings patch route, and aligned commissioner permissions to `league.manage.edit`. |
| 83-014 | 3 | Frontend developer: align PoolMaster league surfaces to the simplified first-class league model | Done | Updated generated-client consumers to use `joinPolicy`, removed active frontend reliance on `League.settings`, and kept league detail/manage surfaces truthful. |
| 83-015 | 4 | Data-modeler: remove speculative league access fields that are not part of approved v1 product truth | Done | `visibility` and `maxMembers` were confirmed as speculative/legacy fields. The approved league model now keeps only `isActive` and `joinPolicy` as lifecycle/access controls. |
| 83-016 | 4 | Backend developer: remove `visibility` and `maxMembers` from league persistence, services, and contracts | Done | Dropped both columns from Prisma, removed repository and service handling, deleted member-limit enforcement, regenerated OpenAPI/SDK/types, and passed the full backend gate. |
| 83-017 | 4 | Frontend developer: remove `visibility` and member-limit assumptions from PoolMaster league UI and tests | Done | League overview/detail surfaces now reflect lifecycle and join policy only, and test fixtures were updated so no PoolMaster consumer still depends on the removed fields. |

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
