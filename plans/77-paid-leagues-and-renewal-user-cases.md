# Plan 77 Companion: Paid Leagues And Renewal User Cases

## Purpose

Capture the future paid-league and renewal/reactivation product model without
blocking the current PoolMaster league-home implementation.

This plan is intentionally deferred for now.

The immediate webapp work should only provide:

- the basic inactive league state
- read-only inactive league home behavior
- structural placeholder space for future commissioner/member actions

## Deferred Status

This plan is not active implementation scope yet.

It exists so renewal/reactivation ideas are documented in one place instead of
leaking into the current league-home plan.

## Future Product Direction

The league home should eventually support more than one inactive-state outcome.

Examples:

- league is not currently active
- league needs renewal
- league is eligible for reactivation
- league is archived or hidden from normal navigation

Those distinct states are deferred until the paid-league/subscription model is
designed.

## Future Actors

- Commissioner
- League Member
- Root Admin

## Deferred Use Cases

### PL-001: Commissioner sees an inactive league that can be renewed

Goal:
- understand why the league is inactive and what action is needed

Direction:
- commissioner can still access the inactive league home
- league home surfaces renewal/reactivation guidance
- action area eventually includes `Renew` or `Reactivate`

### PL-002: Member sees an inactive league awaiting commissioner renewal

Goal:
- understand the league is inactive without exposing billing controls

Direction:
- member sees the same league home in read-only mode
- member does not see renewal controls
- member can contact the commissioner through a future notification/email flow

### PL-003: Commissioner archives or hides an inactive league

Goal:
- remove long-term inactive leagues from primary navigation without data loss

Direction:
- archive/hide behavior should be designed separately from renewal
- archived leagues may eventually leave the default selector experience

### PL-004: Commissioner permanently deletes a league

Goal:
- intentionally remove an unused league

Direction:
- this is a distinct destructive workflow
- it should not be conflated with inactive, archived, or unrenewed states

## Deferred Decisions To Revisit Later

1. What inactive/expired/renewal states should exist as separate statuses?
2. Should commissioner selector rows show multiple visual states beyond a single
   inactive icon?
3. When should inactive leagues disappear from default navigation?
4. How should renewal/reactivation copy differ from generic inactive copy?
5. What is the member-visible explanation when a league is inactive for billing
   reasons?
6. What actions should root-admin users have over paid-league lifecycle?

## Relationship To Active Plans

- [plans/76-league-home-and-league-context-user-cases.md](./76-league-home-and-league-context-user-cases.md)
  owns the current active/inactive league-home behavior
- this plan owns future billing, renewal, reactivation, archive, and paid-league
  lifecycle behavior once that product area becomes active
