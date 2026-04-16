## Objective

Implement the first truthful team-management lane for PoolMaster, using
`Team` terminology in the UI while retaining `Squad` naming internally where
appropriate.

The first slice should cover:

- team creation as part of the join flow
- team naming and built-in icon selection
- dedicated `My Team` management inside league context
- one-or-more owner semantics

## Dependencies

- [94-squad-identity-and-ownership-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/94-squad-identity-and-ownership-user-cases.md)
- [92-league-management-details-and-identity-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/92-league-management-details-and-identity-execution.md)
- [93-my-account-profile-password-and-preferences-execution.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/93-my-account-profile-password-and-preferences-execution.md)

## Planning Notes

- The current backend already has squad CRUD/co-manager APIs, but the active
  model and product semantics do not yet match the approved team direction.
- Current drift that must be reviewed before implementation:
  - `Squad.iconUrl` is still modeled as a free-form URL
  - `SquadMembership` has no explicit owner model or last-owner guard
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
- deciding whether team ownership needs an explicit owner field or can be
  represented through a simpler owner-only membership model
- ensuring exactly one active team per user per league in the first slice
- enforcing that a team cannot be left with zero active owners unless the team
  itself is also being inactivated
- confirming whether existing squad APIs should be retained, renamed, or
  reshaped to align with the approved product behavior

## Data-Modeler Review Notes

- The current `Squad` model still uses `iconUrl`, which no longer fits the
  approved product direction. This should be treated as a model/contract defect
  for the team lane.
- The current `SquadMembership` model has lifecycle state but no explicit
  owner model or last-owner protection. Today, any active squad member is
  effectively treated as a co-manager in service logic. That is not truthful
  enough for the approved simpler “one or more owners” product model.
- The current uniqueness rules already support an important first-slice rule:
  - `@@unique([leagueId, userId])` on `SquadMembership`
  - this prevents a user from belonging to more than one team in the same
    league
- The next truthful model direction is:
  - remove `Squad.iconUrl`
  - add first-class `Squad.iconKey`
  - align membership semantics around one or more owners instead of
    primary-owner/co-owner distinctions
  - enforce the invariant that the last active owner cannot leave or become
    inactive unless the team itself is also being inactivated
- Current service logic should later be updated so:
  - creation assigns the creator as an active owner
  - add/remove owner flows operate on explicit owner semantics rather than
    “any active member can manage”
  - member counts and ownership displays remain simple in the first slice
- This means the team lane does require a real schema/model change before
  backend implementation begins.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 95-001 | 1 | Product review of first-pass team identity and ownership lane | Done | Locked direction from April 15, 2026: UI uses `Team`; every active member has exactly one team per league; team name editable during join; built-in shared icon catalog; one or more owners with no explicit primary/co-owner distinction in the first slice; dedicated `My Team` page first with a league-home shortcut. |
| 95-002 | 1 | Data-modeler review of required squad/team model changes | Done | Review confirmed that current `iconUrl` and ownership semantics are not truthful for the approved product direction. Recommended next model: remove `iconUrl`, add first-class `iconKey`, and align around one-or-more owner semantics with a last-owner guard, while retaining the existing exact-one-team-per-member uniqueness rule. |
| 95-003 | 1 | Backend developer: align squad/team model and API contract to approved product semantics | In Progress | Commissioner league creation and member invitation acceptance now provision a default Team instead of deferring Team creation until contest entry. The broader alignment slice now removes stale `iconUrl`, adds first-class `iconKey` with the shared built-in Team icon catalog, renames owner-management semantics away from co-manager language, and enforces that removing a league member also inactivates their Team ownership with last-owner Team inactivation. Remaining work in this lane is owner add/remove UX and join-flow icon/name editing. |
| 95-004 | 1 | Backend developer: add backend validation and tests for team join/manage/owner flows | In Progress | Unit coverage is green for Team provisioning, icon-aware Team CRUD, contest-entry fallback removal, and last-owner Team inactivation semantics. Functional API coverage remains environment-blocked in this session because local PostgreSQL at `localhost:5432` is unavailable, so the squads functional wrapper cannot complete registration/setup. |
| 95-005 | 2 | Frontend developer: implement join-flow team creation and editing | Not Started | Team creation/editing during join still depends on the deeper backend/model alignment for icon and owner semantics. |
| 95-006 | 2 | Frontend developer: implement dedicated in-league `My Team` page | In Progress | Added a reviewable in-league `My Team` page backed by the real squad APIs: users can create a team if missing, rename it, choose from the built-in 100-option Team icon catalog, and view active team owners. Owner add/remove actions and join-flow Team editing remain next. |
| 95-007 | 2 | Frontend developer: add league-home shortcut/card into the team surface | Done | League home now exposes a `My Team` shortcut so users can reach the dedicated team page directly from league context. |
| 95-008 | 2 | Frontend developer: add UI tests and later browser-journey hooks | In Progress | Component/UI coverage now covers the current `My Team` page create/update flow, including icon selection. Broader Playwright expansion remains deferred until join-flow Team creation and owner management settle. |
