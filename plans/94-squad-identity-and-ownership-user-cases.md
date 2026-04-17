## Purpose

Capture the deferred user-to-squad/team identity lane so it is defined before
implementation and does not get lost while user and league features are being
finished.

## Scope

- team creation during the user join flow
- default team naming
- first-pass team management
- additional owner support

## Starter Design Direction

- Squad identity should become the primary team-facing identity layer shown
  across the product.
- User profile identity and team identity are related but distinct.
- UI should use **Team** terminology while the backend/domain model may keep
  `Squad` naming for internal clarity.
- Avatar upload work is deferred until there is a real upload or avatar
  product flow.

## Locked Product Decisions (April 15, 2026)

- Every active league member should have exactly one active team in that league
  for the first slice.
- Commissioners and members should use the same team-management surface.
- Team name should be editable during the join flow instead of forcing users to
  accept the default and change it later.
- The default team name remains:
  - `<firstName> <lastName>'s Team`
- Team ownership model:
  - one or more owners
  - every team must always retain at least one active owner
  - there is no explicit primary-owner vs co-owner distinction in the first
    slice
  - all owners are equal in the data model
  - `co-owner` is a UI/action label for adding another owner, not a distinct
    ownership tier
  - an owner may not leave or become inactive if that would leave the team with
    zero active owners unless the team itself is also being inactivated
  - additional owners are added through a team-owner invite flow, not by
    attaching an existing league member to a second team
  - validation must reject adding a current league member as an owner of
    another team
- Team icon behavior:
  - remove free-form/custom `iconUrl` behavior from the first slice
  - add one shared built-in icon catalog for all teams
  - use a single sprite sheet
  - aim for roughly 100 options
  - the icons should be sports-themed or sports-inspired, but not
    sport-specific logic
  - some icons can be more avatar-like, some gear-like, and some playful
- UX entry points:
  - build a dedicated in-league `My Team` page first
  - also expose a convenient shortcut or card on league home
  - add a read-only `Teams` view for all members that lists every team in the
    league
  - commissioners can open/edit any team from the `Teams` view
  - members can only edit their own team from the `Teams` view
- Members may leave leagues normally.
- Commissioner leave rules remain a separate league-membership concern:
  - the current backend does not yet enforce “assign another commissioner
    first”
  - that rule should be added in the league-membership lane rather than hidden
    inside team logic

## Starter User Cases

### SQ-001: New user gets a team as part of the join flow

**Actor:** New league member or commissioner

**Preconditions**
- User signs up or joins a league
- User needs a team identity in that league

**Flow**
1. User joins the league
2. System creates the initial squad/team as part of the join flow
3. Team name defaults to `<firstName> <lastName>'s Team`
4. User may edit the team name before completing the join flow
5. User selects a built-in team icon from the curated shared catalog
6. User continues into the product with a valid team identity

**Expected outcomes**
- Team creation is part of the real join flow, not a separate forgotten setup
- Team identity is available immediately
- Team identity is user-configurable at the right moment instead of being left
  as deferred cleanup

### SQ-002: User later manages team details

**Actor:** Team owner

**Preconditions**
- Team exists

**Flow**
1. User opens team management
2. User updates the team name
3. User updates the selected built-in team icon
4. Later, when supported, user may update the team avatar through a separate
   upload or avatar-selection flow

**Expected outcomes**
- Team identity can evolve without changing the underlying user account

### SQ-003: Team owner later adds additional owners

**Actor:** Team owner

**Preconditions**
- Team exists
- multi-owner support has been implemented

**Flow**
1. Owner or commissioner opens team management
2. Actor enters the email address of the intended co-owner
3. System validates that the email does not already belong to another active
   league member in the same league
4. If the email belongs to an existing PoolMaster user outside the league:
   - system immediately creates the league membership and team owner membership
   - system may also send an informational email
5. If the email does not belong to an existing PoolMaster user:
   - system creates a pending invite for co-owner access to the team
   - user follows the normal register/join flow
   - once account creation completes, the user lands as a co-owner of the
     target team
   - the team name and team icon are shown read-only during that welcome flow
6. System updates team ownership relationships and pending invite state

**Expected outcomes**
- Team ownership can expand beyond a single person without merging existing
  league members across teams
- Existing PoolMaster users can be added quickly when they are not already in
  the league
- New users use the familiar join flow, but do not create or edit a separate
  personal team when joining as an invited co-owner

### SQ-003A: Existing league member cannot be added as an owner to another team

**Actor:** Team owner or commissioner

**Preconditions**
- Target email belongs to an active member of the current league

**Flow**
1. Actor attempts to add the email as a co-owner of a team
2. System detects that the email already belongs to a current league member
3. System rejects the request with a clear validation error

**Expected outcomes**
- Existing league members remain attached to exactly one team
- Team-sharing does not implicitly merge or move current league members

### SQ-003B: Team owner or commissioner replaces an owner through a guided flow

**Actor:** Team owner or commissioner

**Preconditions**
- Team exists
- Target owner to be replaced is currently active
- Replacement email does not belong to another active league member

**Flow**
1. Actor chooses `Replace Owner` from the team actions
2. System asks which current owner is being replaced and which email should
   replace them
3. System validates that removing the current owner and adding the replacement
   will not violate league-member and team-owner rules
4. System inactivates the current owner relationship
5. System starts the same co-owner invite/provisioning flow used by `Add
   Co-Owner`
6. System completes the replacement when the new owner is provisioned or
   accepts the invite

**Expected outcomes**
- Users get a clearer guided action than manually combining remove + add
- Replacement remains implementation-wise a remove-owner plus invite-owner flow
- The model still stays flat: owners are equal, and `Replace Owner` is only a
  higher-level UX action

### SQ-004: League home exposes a clear path to team identity

**Actor:** Commissioner or member

**Preconditions**
- User is an active member of a league
- User already has exactly one active team in that league

**Flow**
1. User lands on league home
2. User sees a clear `My Team` or `Manage Team` entry point
3. User opens the dedicated team-management surface

**Expected outcomes**
- Team identity is easy to discover
- Users do not have to hunt through account settings for league-scoped team
  behavior

### SQ-005: All members can browse all teams in the league

**Actor:** Commissioner or member

**Preconditions**
- User is an active member of the league

**Flow**
1. User opens the `Teams` view from league home
2. System shows the current league teams with team name and owner information
3. Members can inspect all teams read-only
4. Commissioners can open any team for editing
5. Members can only open their own team for editing

**Expected outcomes**
- Team identity is visible across the league
- Commissioners can manage all teams from one place
- Members have transparent read-only visibility into the rest of the league
- Team-level actions can be surfaced cleanly from the list, including:
  - edit team
  - add co-owner
  - remove owner
  - replace owner
  - inactivate team

### SQ-006: My Team acts as the team home page

**Actor:** Team owner

**Preconditions**
- User has an active team in the league

**Flow**
1. User opens `My Team`
2. System shows team identity and current owner names and emails
3. Later slices add active and historical contests associated with the team

**Expected outcomes**
- `My Team` is the natural home for team-scoped management
- Team owners can see who manages the team today
- Team contest surfaces can be layered into the same page later

## Deferred Questions To Review During Implementation

- Which current user-facing surfaces should switch from user identity to team
  identity first?
- Should the future owner-transfer flow require an explicit acceptance step?
- How should future team-avatar uploads coexist with the built-in icon catalog?
- How should pending team-owner invites be listed, reminded, revoked, and
  resent in the commissioner/team-owner UI?
- Under what exact conditions may a team be inactivated while preserving the
  invariant that active league members still have a valid active team path?

## Required Model Review Before Implementation

Before implementation, review:

- current `Squad` and `SquadMembership` models
- whether squad ownership semantics are already truthful
- whether any current squad fields are speculative
- whether `iconUrl` should be removed and replaced by a first-class `iconKey`
- whether `SquadMembership` needs an explicit ownership field at all, or
  whether a simpler owner-only membership model is sufficient for the first
  slice
- which current user-facing surfaces should transition from user identity to
  team identity in specific read surfaces

## Follow-On Planning Note

This plan should now feed a concrete execution plan rather than remaining a
loose deferred note. Implementation should still stay backend-first and run
through the data-modeler before frontend work begins.
