## Objective

Implement the first truthful team-management lane for PoolMaster, using
`Team` terminology in the UI while retaining `Squad` naming internally where
appropriate.

The first slice should cover:

- team creation as part of the join flow
- team naming and built-in icon selection
- dedicated `My Team` management inside league context
- league-scoped `Teams` browsing and pending owner-invite visibility
- one-or-more owner semantics
- guided team actions:
  - edit team
  - add co-owner
  - remove owner
  - replace owner
  - inactivate team

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
  - current team-owner add/remove APIs do not yet reflect the approved email
    invite flow for co-owners
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
- validating that an existing league member cannot be added as an owner to
  another team
- defining how pending team-owner invites are represented and surfaced in the
  UI alongside joined teams
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
  - keep ownership flat in the model: all owners are equal, and `co-owner`
    remains a UI/action label rather than a separate persisted role
  - enforce the invariant that the last active owner cannot leave or become
    inactive unless the team itself is also being inactivated
  - reshape owner-add flows so they start from an email address, validate
    against current league membership, and branch between existing-user
    provisioning and normal register/join acceptance
- Current service logic should later be updated so:
  - creation assigns the creator as an active owner
  - add/remove owner flows operate on explicit owner semantics rather than
    “any active member can manage”
  - member counts and ownership displays remain simple in the first slice
- This means the team lane does require a real schema/model change before
  backend implementation begins.

## Recommended Backend Contract

### Model Direction

Do **not** overload `LeagueInvitation` for team-owner flows.

Reason:
- league-member invitations and team-owner invitations have different
  acceptance behavior
- team-owner invitations need to carry target team context
- team-owner invitations must support pending-owner management in the `Teams`
  surface
- team-owner invitations need to support replacement flows

Recommended new persistence model:
- `SquadOwnerInvitation`

Recommended fields:
- `id`
- `leagueId`
- `squadId`
- `email`
- `inviteCode`
- `status`
- `invitedBy`
- `acceptedBy?`
- `acceptedAt?`
- `expiresAt?`
- `replacementForUserId?`
- `createdAt`
- `updatedAt`

Recommended status set:
- `PENDING`
- `ACCEPTED`
- `EXPIRED`
- `REVOKED`

Recommended behavior:
- `replacementForUserId` is optional and only populated for `Replace Owner`
- if email belongs to an existing PoolMaster user outside the league:
  - create/activate league membership
  - create/activate squad ownership
  - mark owner invitation `ACCEPTED`
  - optionally send informational email
- if email belongs to a current league member:
  - reject with validation error
- if email belongs to no PoolMaster user:
  - create pending owner invitation
  - complete through the register/join flow

### Recommended API Shape

Commissioner/team-owner management APIs:
- `GET /api/v1/leagues/:id/squads/owner-invitations`
  - list pending and historical team-owner invites for the league
- `POST /api/v1/leagues/:id/squads/:squadId/owner-invitations`
  - body: `{ email }`
  - starts the `Add Co-Owner` flow
- `POST /api/v1/leagues/:id/squads/:squadId/owners/:userId/replace`
  - body: `{ email }`
  - starts the `Replace Owner` flow
- `POST /api/v1/leagues/:id/squads/owner-invitations/:invitationId/resend`
  - resend or remind
- `DELETE /api/v1/leagues/:id/squads/owner-invitations/:invitationId`
  - revoke pending invite
- keep direct owner removal as a separate action:
  - existing `remove owner` path remains useful

Public/authenticated invitation APIs:
- `GET /api/v1/team-invitations/:inviteCode`
  - preview the team-owner invitation
- `POST /api/v1/team-invitations/:inviteCode/accept`
  - authenticated accept for an existing signed-in user
- unauthenticated new users should carry the invite code through register/login
  and complete acceptance after authentication

### Join/Register Flow Branching

Normal new league member:
- creates account
- joins league
- edits team name and icon during join

Team-owner invite for a new user:
- creates account
- joins league through the owner invitation
- does **not** create a separate personal team
- sees target team identity read-only
- lands with welcome messaging such as:
  - `Welcome to <leagueName>; you are now a co-owner of <teamName>.`

Team-owner invite for an existing PoolMaster user outside the league:
- no extra register step
- membership and ownership are provisioned immediately
- optional email notification can still be sent

### Existing APIs To Reshape

Current direct owner-add API:
- `POST /api/v1/leagues/:id/squads/:squadId/members`
- body: `{ userId }`

Recommended direction:
- deprecate this in favor of email-driven owner invitations
- keep owner removal as a direct action
- keep squad/team CRUD endpoints

## Replace Owner Rule

`Replace Owner` is now locked:
- replacement is only available when the team currently has two or more active
  owners
- the actor invoking replace cannot replace themselves
- commissioner can replace any current owner on the team
- member/team owner can replace only another owner, never themselves
- replacement remains implemented as:
  - inactivate current owner
  - start owner-invite/provisioning flow for replacement email

Backend validation implications:
- reject replace when the team has fewer than two active owners
- reject replace when actor user ID equals target replaced user ID
- reject member/team-owner replace attempts unless the target is another active
  owner on the same team

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 95-001 | 1 | Product review of first-pass team identity and ownership lane | Done | Locked direction from April 15, 2026: UI uses `Team`; every active member has exactly one team per league; team name editable during join; built-in shared icon catalog; one or more owners with no explicit primary/co-owner distinction in the first slice; dedicated `My Team` page first with a league-home shortcut. |
| 95-002 | 1 | Data-modeler review of required squad/team model changes | Done | Review confirmed that current `iconUrl` and ownership semantics are not truthful for the approved product direction. Recommended next model: remove `iconUrl`, add first-class `iconKey`, and align around one-or-more owner semantics with a last-owner guard, while retaining the existing exact-one-team-per-member uniqueness rule. |
| 95-003 | 1 | Backend developer: align squad/team model and API contract to approved product semantics | In Progress | Commissioner league creation and member invitation acceptance now provision a default Team instead of deferring Team creation until contest entry. The broader alignment slice now removes stale `iconUrl`, adds first-class `iconKey` with the shared built-in Team icon catalog, renames owner-management semantics away from co-manager language, and enforces that removing a league member also inactivates their Team ownership with last-owner Team inactivation. Remaining work in this lane is owner add/remove UX and join-flow icon/name editing. |
| 95-004 | 1 | Backend developer: add backend validation and tests for team join/manage/owner flows | In Progress | Unit coverage is green for Team provisioning, icon-aware Team CRUD, contest-entry fallback removal, last-owner Team inactivation semantics, and the new team-owner invitation rules. Functional API coverage for the newer invitation lane still remains to be expanded after the frontend/join-flow branch is wired. |
| 95-005 | 2 | Frontend developer: implement join-flow team creation and editing | In Progress | The co-owner branch is now wired into a dedicated `team-invite` acceptance page with auth-home invitation awareness, read-only team identity, and authenticated acceptance into `My Team`. The normal league invite page now also lets authenticated members set team name and icon during acceptance by immediately updating the just-created Team after join. Remaining work is broader polish around the downstream `Teams` surface and future invite management UX. |
| 95-006 | 2 | Frontend developer: implement dedicated in-league `My Team` page | Done | Added a reviewable in-league `My Team` page backed by the real squad APIs: users can create a team if missing, rename it, choose from the built-in 100-option Team icon catalog, invite co-owners by email, remove owners, replace owners, revoke pending owner invites, and view active team owners. Commissioners can also target any team through the same page using league-scoped navigation. |
| 95-007 | 2 | Frontend developer: add league-home shortcut/card into the team surface | Done | League home now exposes a `My Team` shortcut so users can reach the dedicated team page directly from league context. |
| 95-008 | 2 | Frontend developer: add UI tests and later browser-journey hooks | In Progress | Component/UI coverage now covers the current `My Team` page create/update flow, including icon selection. Broader Playwright expansion remains deferred until join-flow Team creation, pending owner invites, and owner-management settle. |
| 95-009 | 3 | Backend developer: implement co-owner invite flow from email with existing-user shortcut | In Progress | Added backend-first owner-invitation infrastructure: new `SquadOwnerInvitation` model, preview/accept APIs, league-scoped invite listing and revoke APIs, co-owner invite-by-email flow, immediate provisioning for existing PoolMaster users outside the league, rejection of current league members, and replace-owner guardrails. The frontend join/register branch is now partially integrated through the dedicated `team-invite` acceptance page. Remaining work is later resend/reminder behavior if we decide to add it. |
| 95-010 | 3 | Frontend developer: add league-scoped `Teams` view with joined teams and pending owner invites | In Progress | Added the first real `Teams` directory route and league-home entry point. The page lists joined teams league-wide, shows pending owner invitations with revoke actions, and lets commissioners jump into any team through the shared team-management page while members only get direct management links for their own team. `Edit Team`, `Add Co-Owner`, `Remove Owner`, and `Replace Owner` now land through the shared team-management page. Remaining work is the later `Inactivate Team` lifecycle action. |
