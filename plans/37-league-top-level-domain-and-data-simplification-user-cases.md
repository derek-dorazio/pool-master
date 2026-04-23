# Plan 37 Companion: League-Top-Level Domain And Data Simplification User Cases

## Purpose

This companion document captures the product use cases and user flows implied by
[Plan 37](./37-league-top-level-domain-and-data-simplification.md).

It focuses on what people do in the product so future web/admin planning can build
on user behavior, not just schema changes.

## Primary Actors

- Visitor
- Registered User
- League Member
- League Commissioner
- Squad Co-Manager

## Core Product Boundary Cases

### LG-001: Create a league

Actor:
- Registered User

Goal:
- create a new durable league as the top-level product unit

Flow:
1. User starts league creation.
2. User enters league basics.
3. Backend creates the league.
4. Backend creates the creator's active league membership as `COMMISSIONER`.
5. League becomes the durable container for members, squads, contests, and subscription.

### LG-002: Belong to multiple leagues with one account

Actor:
- Registered User

Goal:
- participate in multiple leagues without creating multiple accounts

Flow:
1. User accepts invites for different leagues over time.
2. Backend creates or reactivates league memberships for each league.
3. App shows the leagues available to the same user.
4. User switches league context in the UI.

### LG-003: Hold different roles in different leagues

Actor:
- Registered User

Goal:
- be a commissioner in one league and a member in another

Flow:
1. User belongs to multiple leagues.
2. Each `LeagueMembership` stores role independently.
3. UI enables or hides commissioner tools per league context.

## Membership And Invite Cases

### LG-004: Commissioner invites a person to a league

Actor:
- League Commissioner

Goal:
- onboard a new member into the league

Flow:
1. Commissioner opens people/invite tools.
2. Commissioner generates an invite code or invite link.
3. Commissioner optionally binds the invite to an email address.
4. Invite remains active until accepted or inactivated.

### LG-005: Invited person joins as a member

Actor:
- Invited Visitor or Existing User

Goal:
- become a normal league member

Flow:
1. Invitee opens invite flow.
2. Invitee logs in or signs up.
3. Backend validates the invite.
4. Backend creates or reactivates league membership as `MEMBER`.
5. Invitee lands inside the league.

Notes:
- invites do not grant `COMMISSIONER` directly in the first pass

### LG-006: Commissioner promotes a member to commissioner

Actor:
- League Commissioner

Goal:
- share league administration with a peer

Flow:
1. Commissioner opens league membership management.
2. Commissioner selects a member.
3. Commissioner changes role from `MEMBER` to `COMMISSIONER`.
4. Backend validates the action and saves the membership change.

### LG-007: Commissioner demotes a commissioner to member

Actor:
- League Commissioner

Goal:
- reduce privileges for another league member

Flow:
1. Commissioner opens the same league management tool.
2. Commissioner changes the role from `COMMISSIONER` to `MEMBER`.
3. Backend validates that the league still has at least one active commissioner.

### LG-008: Member leaves a league

Actor:
- League Member or Commissioner

Goal:
- stop being active in the league without deleting historical participation

Flow:
1. User chooses leave league.
2. Backend inactivates the membership instead of deleting it.
3. Historical relationships remain intact.

### LG-009: Former member rejoins the league

Actor:
- Previously inactive member

Goal:
- rejoin without losing historical identity

Flow:
1. User receives a new invite.
2. Backend finds the existing inactive membership.
3. Backend reactivates the membership instead of creating a new row.

## Squad Cases

### LG-010: Create a squad

Actor:
- Active League Member

Goal:
- create the durable contest-playing identity for league participation

Flow:
1. Member creates a squad.
2. Backend creates the squad inside the league.
3. Backend creates active `SquadMembership` for the creator.
4. Default squad name is generated from the creator's name for low friction.

Notes:
- common one-owner case should feel nearly seamless

### LG-011: Rename a squad

Actor:
- Squad Co-Manager

Goal:
- customize the squad's display identity

Flow:
1. Co-manager edits squad details.
2. Backend updates squad name and optional icon.
3. Future displays show the new squad identity.

### LG-012: Invite or add a co-manager to a squad

Actor:
- Squad Co-Manager

Goal:
- let another league member help manage the same squad

Flow:
1. Co-manager opens squad management.
2. Co-manager adds another active league member to the squad.
3. Backend creates or activates `SquadMembership`.

### LG-013: Remove a co-manager from a squad

Actor:
- Squad Co-Manager

Goal:
- stop another user from managing the squad

Flow:
1. Co-manager removes a squad member.
2. Backend inactivates the `SquadMembership`.
3. If no active squad managers remain, the squad becomes inactive.

### LG-014: User has only one squad in a league

Actor:
- League Member

Goal:
- keep squad ownership simple inside each league

Flow:
1. User attempts to create or join another squad in the same league.
2. Backend enforces the one-squad-per-user-per-league rule.

## Subscription Cases

### LG-015: League pays for a plan

Actor:
- League Commissioner

Goal:
- upgrade the league's capabilities

Flow:
1. Commissioner opens subscription/billing for the league.
2. Commissioner chooses monthly or annual plan.
3. Backend attaches subscription to the league.
4. League limits and capabilities update.

### LG-016: Subscription expires

Actor:
- League (system effect)

Goal:
- fall back to the free tier without deleting league data

Flow:
1. Subscription reaches expiry.
2. Backend downgrades the league to free tier.
3. Product enforces free-tier limits moving forward.

## Event And Participant Cases

### LG-017: Contest uses a global sports event

Actor:
- League Commissioner

Goal:
- configure contests against a shared imported event like the 2025 Masters

Flow:
1. Commissioner selects a `SportEvent`.
2. Contest references that global event.
3. Participants come from the event field.
4. Event season/year comes from the `SportEvent`, not from the league.

### LG-018: Participant exists globally across events

Actor:
- System/domain behavior

Goal:
- reuse the same competitor across many events

Flow:
1. A canonical `Participant` exists for a player or team.
2. Many `SportEventParticipant` rows place that participant into specific event fields.
3. PoolMaster-derived valuation is attached at the event-participant level.

## UX And API Implications

The future UI will likely need:

- league switcher
- league member management
- commissioner tools for membership role changes
- squad creation and squad co-management UI
- league-scoped billing/subscription management

The future backend/API will likely need:

- league membership lifecycle endpoints
- commissioner role-management endpoints
- squad creation/update endpoints
- squad co-manager management endpoints
- league-bound subscription endpoints

## Open Product Questions

These remain intentionally open:

1. How should admin capability attach to the same global user model?
2. Should inactive memberships and squads appear by default or behind filters in UI surfaces?
3. Should future billing tiers cap active squads, and how should commissioner-level caps work?
