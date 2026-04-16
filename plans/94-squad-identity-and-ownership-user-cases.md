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
  - an owner may not leave or become inactive if that would leave the team with
    zero active owners unless the team itself is also being inactivated
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
1. Owner opens team management
2. Owner invites or adds additional owners
3. System updates team ownership/management relationships

**Expected outcomes**
- Team ownership can expand beyond a single person when the feature is ready

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

## Deferred Questions To Review During Implementation

- Which current user-facing surfaces should switch from user identity to team
  identity first?
- Should the future owner-transfer flow require an explicit acceptance step?
- How should future team-avatar uploads coexist with the built-in icon catalog?

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
