## Objective

Implement the first truthful team-management lane for PoolMaster, using
`Team` terminology in the UI while retaining `Squad` naming internally where
appropriate.

The first slice should cover:

- team creation as part of the join flow
- team naming and built-in icon selection
- dedicated `My Team` management inside league context
- primary-owner and co-owner semantics

## Dependencies

- [94-squad-identity-and-ownership-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/94-squad-identity-and-ownership-user-cases.md)
- [92-league-management-details-and-identity-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/92-league-management-details-and-identity-execution.md)
- [93-my-account-profile-password-and-preferences-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/93-my-account-profile-password-and-preferences-execution.md)

## Planning Notes

- The current backend already has squad CRUD/co-manager APIs, but the active
  model and product semantics do not yet match the approved team direction.
- Current drift that must be reviewed before implementation:
  - `Squad.iconUrl` is still modeled as a free-form URL
  - `SquadMembership` has no explicit ownership/co-owner role field
  - current backend treats any active squad member as effectively a co-manager
  - current join flow does not yet require or collect truthful team identity
- This lane must remain backend-first:
  - product review
  - data-model review
  - backend/model changes
  - frontend implementation
  - later browser-E2E expansion

## Expected Model Review Focus

The data-modeler should explicitly review:

- removing `Squad.iconUrl`
- adding first-class `Squad.iconKey`
- defining a closed built-in team icon catalog for the backend/frontend
  contract
- adding a `SquadMembership.role` concept or equivalent truthful ownership
  representation
- ensuring exactly one active team per user per league in the first slice
- confirming whether existing squad APIs should be retained, renamed, or
  reshaped to align with the approved product behavior

## Data-Modeler Review Notes

- The current `Squad` model still uses `iconUrl`, which no longer fits the
  approved product direction. This should be treated as a model/contract defect
  for the team lane.
- The current `SquadMembership` model has lifecycle state but no explicit
  ownership role. Today, any active squad member is effectively treated as a
  co-manager in service logic. That is not truthful enough for the approved
  “primary owner + optional co-owners” product model.
- The current uniqueness rules already support an important first-slice rule:
  - `@@unique([leagueId, userId])` on `SquadMembership`
  - this prevents a user from belonging to more than one team in the same
    league
- The next truthful model direction is:
  - remove `Squad.iconUrl`
  - add first-class `Squad.iconKey`
  - add explicit `SquadMembership.role`
    - likely `PRIMARY_OWNER`
    - likely `CO_OWNER`
- Current service logic should later be updated so:
  - creation assigns the creator as `PRIMARY_OWNER`
  - add/remove co-owner flows operate on explicit membership roles rather than
    “any active member can manage”
  - member counts and ownership displays remain role-aware but still simple in
    the first slice
- This means the team lane does require a real schema/model change before
  backend implementation begins.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 95-001 | 1 | Product review of first-pass team identity and ownership lane | Done | Locked direction from April 15, 2026: UI uses `Team`; every active member has exactly one team per league; team name editable during join; built-in shared icon catalog; one primary owner plus optional co-owners; dedicated `My Team` page first with a league-home shortcut. |
| 95-002 | 1 | Data-modeler review of required squad/team model changes | Done | Review confirmed that current `iconUrl` and ownership semantics are not truthful for the approved product direction. Recommended next model: remove `iconUrl`, add first-class `iconKey`, and add explicit `SquadMembership.role` for `PRIMARY_OWNER` and `CO_OWNER`, while retaining the existing exact-one-team-per-member uniqueness rule. |
| 95-003 | 1 | Backend developer: align squad/team model and API contract to approved product semantics | Not Started | Remove retired fields, add truthful ownership/icon semantics, refresh DTOs/OpenAPI/generated SDK, and keep contracts backend-first. |
| 95-004 | 1 | Backend developer: add backend validation and tests for team join/manage/co-owner flows | Not Started | Cover join-time team creation, rename/icon update, co-owner add/remove, and ownership/leave edge cases approved for this slice. |
| 95-005 | 2 | Frontend developer: implement join-flow team creation and editing | Not Started | Team creation/editing during join still depends on the deeper backend/model alignment for icon and ownership semantics. |
| 95-006 | 2 | Frontend developer: implement dedicated in-league `My Team` page | In Progress | Added a reviewable first Team page backed by the existing squad APIs: users can create a team if missing, rename it, and view active team members. Built-in icon selection and explicit ownership/co-owner labels remain deferred until the backend model is updated. |
| 95-007 | 2 | Frontend developer: add league-home shortcut/card into the team surface | Done | League home now exposes a `My Team` shortcut so users can reach the dedicated team page directly from league context. |
| 95-008 | 2 | Frontend developer: add UI tests and later browser-journey hooks | Not Started | Component/UI coverage should land in this lane; broader Playwright expansion remains deferred until user/league/team surfaces settle. |
