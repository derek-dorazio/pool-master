# Plan 37: League-Top-Level Domain And Data Simplification

## Purpose

Simplify PoolMaster's core domain model so it matches the real product shape:

- `League` becomes the top-level customer/workspace boundary
- `User` becomes a global identity shared across leagues
- membership and authorization become league-based
- billing/subscriptions move from `tenant` to `league`
- event/season modeling becomes global and contest-centered instead of tenant-centered

This plan should be completed before the implementation phases of [Plan 36](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/36-authentication-and-authorization-unification.md) that depend on the final identity and authorization boundary.

## Why This Plan Exists

The current schema mixes two different product stories:

- a B2B-style `Tenant -> User + League` hierarchy
- a consumer league product where leagues are the durable social and commercial unit

That creates friction in several places:

- `User.tenantId` prevents a clean one-user/many-leagues model
- `League.tenantId` makes leagues look subordinate to an account boundary that users do not experience directly
- billing and entitlement logic currently attaches to `tenant`
- auth embeds `tenantId` into request identity and JWT/session expectations
- `Season` is tenant-owned, even though season/year is really part of the sport/event domain
- `SportEvent` exists globally, but it is not yet the full global event boundary for contest configuration and imported fields

## Product Model To Adopt

### League as the top-level boundary

League becomes the durable top-level product container:

- a league has members
- a league has one or more commissioners/owners
- a league runs many contests over time
- a league persists across years and seasons
- a league has its own subscription tier

### Global user identity

One user can:

- belong to many leagues
- have different roles in different leagues
- use one login across all leagues they belong to

### League membership and squads

League membership and contest-entry identity should be split:

- `LeagueMembership` answers "is this user part of this league?"
- `Squad` answers "what persistent contest-playing unit exists inside this league?"
- `SquadMembership` answers "which users co-manage this squad?"
- `ContestEntry` answers "which squad entered this contest?"

This supports:

- one user in many leagues
- many users co-managing one squad
- one league containing many squads
- one squad persisting across many contests
- one squad entering a contest once by default, or multiple times if contest rules allow it

### Subscription model

Subscriptions should be simple time-bound plans:

- monthly or annual
- attached to a league
- with an expiry date
- on expiry, the league falls back to the free tier

Subscriptions should not be modeled as season-bound.

### Event and season model

Season/year should live with the global sports-data event domain, not with tenant or league.

Example:

- `SportEvent`
  - sport: `golf`
  - name: `Masters Tournament`
  - season/year: `2025`
  - participants: the 2025 field

Contests should reference the global event they are built around.

## Desired Target Shape

### Identity and membership

- `User`
  - global person/account identity
- `League`
  - top-level customer/workspace boundary
- `LeagueMembership`
  - the primary membership and per-league role/permission model
- `Squad`
  - the persistent contest-playing unit within a league
- `SquadMembership`
  - the co-manager relationship between users and squads
- admin capability
  - linked to the same global user identity

### Billing

- `LeagueSubscription`
- `LeagueUsage`
- `LeagueEntitlementOverride`

These replace tenant-bound commercial constructs.

### Global sports-data/event model

- `Sport`
- `SportEvent`
  - global imported event/tournament/race/weekend/game-set boundary
- `SportEventParticipant`
  - joins participants into the event field
- `Participant`
  - global participant identity within a sport
- optional event or season stat records

### Contest relationship

- `Contest`
  - belongs to a `League`
  - references a `SportEvent` when imported or event-backed
- `ContestEntry`
  - belongs to a `Contest`
  - references a `Squad`, not a direct user membership
- contest pools, matchups, picks, and scoring references should point to the global event boundary through real relations, not loose UUID conventions

## Current Model Problems To Fix

### Problem A: Tenant-owned users

Today:

- `User.tenantId`

Problem:

- one user cannot naturally belong to multiple league/account contexts
- this fights the desired one-login/many-leagues model

### Problem B: League under tenant

Today:

- `League.tenantId`

Problem:

- the product experience treats league as the primary container
- tenant is mostly a hidden abstraction except in admin/billing

### Problem B2: Contest entries are tied to league membership instead of a squad

Today:

- `ContestEntry.leagueMembershipId`

Problem:

- the contest-playing unit is a person-membership row rather than a durable squad identity
- co-managers are not supported cleanly
- creative squad naming/iconography is not first-class
- contest participation cannot cleanly persist independently of an individual user's direct membership row

### Problem C: Tenant-bound billing

Today:

- plan tiers, subscriptions, usage, and entitlements are tied to `tenantId`

Problem:

- the desired paid unit is the league, not a hidden parent account

### Problem D: Tenant-owned seasons

Today:

- `Season.tenantId`
- `Contest.seasonId`

Problem:

- season/year is not really league-owned or tenant-owned
- it belongs to the global sports/event domain

### Problem E: Incomplete global event boundary

Today:

- `SportEvent` exists and is global
- `ContestPool.eventId`, `ContestMatchup.eventId`, and `ContestPick.eventId` exist
- but these are not modeled as strong Prisma relations
- `SportEvent` does not carry an explicit season/year field
- there is no first-class event-field join model like `SportEventParticipant`

Problem:

- imported field ownership is unclear
- event participants are not modeled as an explicit global field
- contest/event references are weaker than they should be

## Design Decisions To Lock

### Decision A: Remove tenant entirely vs retain a reduced billing shell

Recommended decision:

- eliminate `Tenant` entirely
- attach billing/subscription directly to `League`
- do not introduce a replacement hidden parent container

### Decision B: User identity boundary

Recommended decision:

- `User` is global
- `LeagueMembership` is the only normal product-membership relationship

### Decision B2: League membership lifecycle

Recommended decision:

- keep one durable `LeagueMembership` row per `(leagueId, userId)`
- never hard-delete memberships
- reactivation should reuse the existing row
- model lifecycle with:
  - `status`: `ACTIVE` / `INACTIVE`
  - `statusReason`: values such as `INVITED`, `PENDING`, `LEFT`, `REMOVED`
- league roles are simplified to:
  - `COMMISSIONER`
  - `MEMBER`
- a league must always have at least one active commissioner

### Decision B3: Invitation model

Recommended decision:

- leagues are invite-only in the first pass
- there is no `invitePolicy` field in the first-pass model
- no open join flow
- no approval workflow
- invitations create or reactivate memberships as `MEMBER`
- invitations do not carry custom permissions
- commissioners can later promote a member to `COMMISSIONER`
- invitations are single-use
- generic invite codes are supported
- optional invited-email binding is supported
- if an invited email is present, acceptance should require an account with that same email
- invitation acceptance should use a single combined invite + account-creation/login flow when the invitee is not yet registered

### Decision B4: Squad model

Recommended decision:

- `Squad` belongs to one `League`
- `SquadMembership` links users to squads as co-managers
- squad membership requires active league membership
- squads are the primary contest-entry concept
- squads can have creative names and icons
- squads can have multiple active managers
- a user may belong to only one squad per league
- if the last active squad manager becomes inactive, the squad becomes inactive
- no separate squad role model is needed in the first pass if all co-managers act equally
- the data model should accept many squads per league, but operational limits should come from commissioner settings and billing-tier enforcement rather than schema constraints

### Decision C: Admin identity boundary

Recommended decision:

- `AdminUser` should not remain a separate browser-auth identity
- platform-admin capability should link to the same global user identity

### Decision D: Season and event model

Recommended decision:

- season/year moves to `SportEvent`
- `Contest` references `SportEvent`
- imported/global event field is modeled explicitly

### Decision E: League as the paid unit

Recommended decision:

- `League` is the paid unit
- each league has its own subscription/tier
- there is no bundle or parent-account billing abstraction in this simplification
- five leagues means five separate subscriptions

### Decision F: Subscription lifecycle

Recommended decision:

- subscription is time-bound only
- monthly or annual
- league falls back to free tier when expired
- contest/year limits are enforced by plan/usage rules, not by subscription-season coupling

### Decision G: SportEventParticipant model

Recommended decision:

- `SportEventParticipant` means "this canonical participant is in the official field for this event"
- it must always reference a canonical `Participant`
- unresolved imports do not enter the core event-field model
- enforce unique `(sportEventId, participantId)`

Recommended fields:

- `sportEventId`
- `participantId`
- `fieldRank`
- `status`
  - simple active/inactive lifecycle
- `statusReason`
  - more specific enum-like reason such as `WITHDRAWN`, `DISQUALIFIED`, `CUT`, `SCRATCHED`

### Decision H: SportEventParticipant source and valuation data

Recommended decision:

- imported/provider data lives in `SportEventParticipantSourceData`
- PoolMaster-derived pricing/tiering lives in `SportEventParticipantValuation`
- source data and PoolMaster valuation stay separate

`SportEventParticipantSourceData` should be many-to-one from `SportEventParticipant`.

`SportEventParticipantValuation` should include:

- `contestPrice`
- `contestTier`
- `orderIndex`

### Decision I: Contest field behavior

Recommended decision:

- a contest references the full official event field through its `SportEvent`
- no contest-level exclusions in the first-pass model
- exclusions can be added later as a separate enhancement if needed

### Decision I2: Contest entry behavior

Recommended decision:

- `ContestEntry` references `Squad`
- every contest entry belongs to exactly one squad
- contests default to one entry per squad
- certain contest configurations may allow multiple entries per squad later
- this should be modeled as a contest rule such as `maxEntriesPerSquad`, not as a squad rule
- contest history should show current squad/co-manager state in the first pass rather than introducing entry-time snapshot fields immediately

### Decision J: SportEvent shape

Recommended decision:

- `SportEvent` explicitly includes:
  - `seasonYear`
  - optional `seasonLabel`
  - optional `seriesOrTour`

### Decision K: Participant abstraction

Recommended decision:

- `Participant` is the universal competitor abstraction for both players and teams
- add `participantType` enum:
  - `PLAYER`
  - `TEAM`
- keep:
  - required `displayName`
  - optional `playerFirstName`
  - optional `playerLastName`
  - optional `teamName`

### Decision L: Audit field convention

Recommended decision:

- standard audit timestamps remain universal on domain entities:
  - `createdAt`
  - `updatedAt`
- actor audit references should be an explicit convention for human-authored mutable records, not a universal base requirement:
  - `createdByUserId?`
  - `updatedByUserId?`
- system-generated, import-generated, and derived rows may omit actor references where no meaningful human author exists

## Proposed Schema Direction

### Models to remove or phase out

- `Tenant`
- `Season` as currently modeled
- tenant-bound billing models

### Models to reshape

- `User`
  - remove `tenantId`
  - add the standard auth/account fields tracked in Plan 36
- `League`
  - remove `tenantId`
  - add plan/subscription linkage
- `LeagueMembership`
  - simplify role model to `COMMISSIONER` / `MEMBER`
  - add lifecycle state instead of relying on deletion
- `LeagueInvitation`
  - simplify to invite-only, single-use semantics
- `ContestEntry`
  - stop pointing at `LeagueMembership`
  - point at `Squad`
- `AdminUser`
  - link to `User`, or merge into a linked capability/grant model
- `Participant`
  - become the universal player/team abstraction with `participantType`, `displayName`, and optional player/team-specific fields
- `SportEvent`
  - add `seasonYear`
  - add optional `seasonLabel`
  - add optional `seriesOrTour`
  - add stronger contest/event relations

### Models to add

- `Squad`
- `SquadMembership`
- `SportEventParticipant`
- `SportEventParticipantSourceData`
- `SportEventParticipantValuation`
- `LeagueSubscription`
- `LeagueUsage`
- `LeagueEntitlementOverride` or equivalent
- possibly a renamed/reshaped session model if implemented alongside Plan 36

## Workstreams

### Workstream 1: Core identity and league boundary

- global user model
- league ownership/membership model
- squad and contest-entry model
- removal of tenant ownership

### Workstream 2: Billing migration to league

- subscriptions
- usage
- entitlements
- plan fallback on expiry

### Workstream 3: Global event and season model

- season/year on event
- explicit event field
- stronger contest/event references

### Workstream 4: Admin and support model adaptation

- admin views and tooling that currently assume tenants
- support/export/flag surfaces
- migration of admin routes and DTOs

### Workstream 5: Data migration and compatibility cleanup

- backfill/migration scripts
- remove dead tenant paths
- update docs, rules, clients, generated contracts, and tests

## Action Plan

| ID | Workstream | Task | Status | Notes |
|---|---|---|---|---|
| 37-001 | 1 | Finalize the top-level product boundary decision: leagues replace tenants as the primary customer/workspace boundary | In Progress | User direction in this thread points strongly to league-as-top-level |
| 37-002 | 1 | Remove `Tenant` entirely from the target domain model and identify all schema, service, DTO, and admin surfaces that must be migrated off it | In Progress | Locked by product direction in this thread |
| 37-003 | 1 | Design the global `User` model with no `tenantId`, and confirm that all normal product access flows through `LeagueMembership` and `SquadMembership` | In Progress | Locked direction: one user across many leagues, with league membership separate from squad co-management |
| 37-004 | 1 | Design the unified user/admin identity model so platform-admin capability links to the same global user identity | Not Started | Pending further review discussion |
| 37-004A | 1 | Redesign `LeagueMembership` around durable active/inactive lifecycle state with only `COMMISSIONER` and `MEMBER` roles | In Progress | Locked: never delete, reactivate on rejoin, retain history, always keep at least one active commissioner |
| 37-004B | 1 | Redesign `LeagueInvitation` as invite-only, single-use onboarding with generic codes and optional invited-email matching | In Progress | Locked: no open join, no approval workflow, no `invitePolicy`, accepted invites create/reactivate `MEMBER` memberships through a single invite + signup/login flow |
| 37-004C | 1 | Add `Squad` and `SquadMembership` so contest-playing identity is separate from league membership and supports co-managers | In Progress | Locked: squads belong to leagues, co-managers act equally, one squad per user per league, inactive squad when no active managers remain |
| 37-005 | 2 | Redesign billing/subscription models from tenant-bound to league-bound | In Progress | Includes subscription, usage, entitlements, and plan overrides |
| 37-006 | 2 | Define the subscription lifecycle: monthly/annual periods, expiry, downgrade to free tier, and enforcement behavior | In Progress | Locked: monthly/annual, expires by date, falls back to free tier |
| 37-007 | 2 | Rework plan limits so they apply per league: members, contests/year, contest types, draft styles, and premium capabilities | In Progress | Locked packaging direction from this thread |
| 37-008 | 3 | Remove tenant-owned `Season` and design the new global event/season model | In Progress | Locked: season/year belongs to global event/imported data |
| 37-009 | 3 | Expand `SportEvent` into the first-class global event boundary with explicit season/year semantics | In Progress | Locked: `seasonYear`, optional `seasonLabel`, optional `seriesOrTour` |
| 37-010 | 3 | Add `SportEventParticipant` as the canonical official event-field model with unique `(sportEventId, participantId)` membership | In Progress | Locked: `fieldRank`, `status`, `statusReason`, strict canonical participant reference |
| 37-011 | 3 | Add `SportEventParticipantSourceData` and `SportEventParticipantValuation` to separate imported/provider data from PoolMaster-derived valuation data | In Progress | Locked valuation fields: `contestPrice`, `contestTier`, `orderIndex` |
| 37-012 | 3 | Redesign contest/event references so contests, pools, matchups, and picks use strong relations to global events and the full official event field | In Progress | Locked first pass: contests use the full event field with no exclusion layer |
| 37-013 | 3 | Reshape `Participant` into the universal competitor abstraction for both players and teams | In Progress | Locked: `participantType`, required `displayName`, optional player/team-specific fields |
| 37-013A | 3 | Redesign `ContestEntry` to reference `Squad` instead of direct league membership and support per-contest entry-count rules | In Progress | Locked: one entry per squad by default, higher limits allowed by contest configuration later |
| 37-014 | 4 | Identify all admin/support/billing surfaces that assume tenants and redesign them around leagues or platform-wide views | Not Started | Includes tenant pages, exports, support, feature overrides, and billing screens |
| 37-015 | 5 | Produce the database migration strategy for removing `tenantId` from users/leagues and migrating tenant billing data to leagues | Not Started | Needs careful backfill and rollout sequencing |
| 37-016 | 5 | Update DTOs, OpenAPI, generated clients, rules, docs, and tests to match the new league-top-level model | Not Started | Keep contracts and docs truthful throughout |
| 37-017 | 5 | Define the dependency boundary between Plan 37 and Plan 36 and sequence implementation accordingly | In Progress | Plan 36 auth implementation should build on the final boundary model, not the old tenant model |

## Remaining Questions For Next Review

These decisions are still open and should be refined before implementation starts:

1. How should unified admin capability attach to the global `User` model after `AdminUser` is removed or linked?
2. Should `LeagueInvitation` lifecycle use a dedicated enum such as `PENDING` / `ACCEPTED` / `EXPIRED` / `REVOKED`, or also adopt the shared `ACTIVE` / `INACTIVE` plus reason pattern?
3. Should leagues place an explicit cap on active squads as part of billing-tier enforcement, and if so where should the commissioner-configurable cap live?
4. Should squad membership ever support a future primary-contact concept, or should all co-managers remain permanently equivalent unless a stronger use case appears?
5. How should admin/support exports and dashboards represent inactive league memberships and inactive squads once soft-deletion becomes the norm?

## Relationship To Plan 36

Plan 36 should not implement the final auth/session model on top of the current tenant-owned user model if this plan is accepted.

Recommended sequencing:

1. lock the League-top-level model in Plan 37
2. implement the core domain/data-model changes from Plan 37
3. then implement Plan 36 auth/session work on top of the simplified model

This avoids migrating authentication twice:

- once for the old tenant model
- and again for the league-top-level model
