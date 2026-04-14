## Purpose

Capture the deferred user-to-squad/team identity lane so it is defined before
implementation and does not get lost while user and league features are being
finished.

## Scope

- squad creation during the user join flow
- default squad naming
- later squad management and co-owner support

## Starter Design Direction

- Squad identity should become the primary team-facing identity layer shown
  across the product.
- User profile identity and squad/team identity are related but distinct.
- Avatar work is deferred until there is a real avatar-selection or file-upload
  product flow.

## Starter User Cases

### SQ-001: New user gets a squad as part of the join flow

**Actor:** New league member or commissioner

**Preconditions**
- User signs up or joins a league
- User needs a team/squad identity in that league

**Flow**
1. User joins the league
2. System creates the initial squad as part of the join flow
3. Squad name defaults to `<firstName> <lastName>'s Team`
4. User continues into the product with a valid squad identity

**Expected outcomes**
- Squad creation is part of the real join flow, not a separate forgotten setup
- Team identity is available immediately

### SQ-002: User later manages squad details

**Actor:** Squad owner

**Preconditions**
- Squad exists

**Flow**
1. User opens squad/team management
2. User updates the squad name
3. Later, when supported, user updates the squad avatar

**Expected outcomes**
- Squad identity can evolve without changing the underlying user account

### SQ-003: Squad owner later invites co-owners

**Actor:** Squad owner

**Preconditions**
- Squad exists
- Co-owner support has been implemented

**Flow**
1. Owner opens squad/team management
2. Owner invites or adds co-owners
3. System updates squad ownership/management relationships

**Expected outcomes**
- Squad ownership can expand beyond a single person when the feature is ready

## Deferred Questions To Review During Implementation

- Should every league membership always imply exactly one squad in the first
  pass?
- Should commissioners and members follow the same squad-creation flow?
- Should squad naming be editable immediately during join, or only after the
  default is created?
- How should squad co-ownership map to current membership and role concepts?
- Which current user-facing surfaces should switch from user identity to squad
  identity first?

## Required Model Review Before Implementation

Before implementation, review:

- current `Squad` and `SquadMembership` models
- whether squad ownership semantics are already truthful
- whether any current squad fields are speculative
- whether user-facing identity should transition from `displayName` to squad
  identity in specific read surfaces

## Follow-On Planning Note

This plan should remain deferred until after the current user and league
feature lanes are complete.
