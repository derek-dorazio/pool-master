# Plan 38: Contest, Entry, And Squad Alignment Review

## Purpose

Capture the current contest/configuration/entry model, compare it against the emerging
league-first and squad-first domain direction in [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md),
and surface the design questions that should be resolved before implementation starts.

This is a review-and-decision plan, not an implementation plan yet.

## Current Model Summary

### Core contest objects today

- `Contest`
  - belongs to `League`
  - still optionally references `Season`
  - stores `contestType`, `selectionType`, `scoringEngine`, timing, payout, and scoring settings
- `SelectionConfig`
  - large contest-owned configuration table with many nullable fields for all selection modes
- `ContestPool`
  - contest-owned participant-pool configuration
  - optionally references `eventId`
  - supports exclusions and pool locking
- `ContestParticipantPool`
  - resolved contest-local field
  - stores contest-local `cost`, `tier`, `ranking`, availability, and availability reason
- `ContestEntry`
  - belongs to `Contest`
  - currently references `LeagueMembership`
  - unique on `(contestId, leagueMembershipId)`
- `RosterPick`, `ContestPick`, `BracketPrediction`, `DraftSession`, `DraftPick`
  - all hang off `ContestEntry`
- `ContestStanding`, `ContestResult`, `TeamRosterHistory`, `PayoutHistory`
  - mostly entry-centric but denormalized around `leagueMembershipId`

### Current service behavior

Contest service behavior today:

- contest creation is league-scoped and tenant-aware
- create-contract currently only allows:
  - `ContestType.SINGLE_EVENT`
  - `SelectionType.SNAKE_DRAFT`
  - `SelectionType.TIERED`
  - `SelectionType.BUDGET_PICK`
- entry creation requires league membership
- entry identity defaults to the member's display name
- one member gets at most one entry in a contest
- entry removal is blocked after any picks or draft selections exist

Pool/pricing behavior today:

- event-backed pools are optional
- contest-local pool resolution builds a participant list
- contest-local pricing and tier assignment write onto `ContestParticipantPool`
- exclusions exist at contest-pool level

History behavior today:

- many history and analytics surfaces use `leagueMembershipId` as the durable identity
- contest results and payout history denormalize member-oriented fields

## Comparison Against Plan 37 Direction

Plan 37 now points toward:

- `League` as the top-level product/commercial boundary
- global `User`
- `LeagueMembership` as league participation
- `Squad` and `SquadMembership` as contest-playing identity
- `ContestEntry` referencing `Squad`, not direct member rows
- `SportEvent` as the global event boundary
- `SportEventParticipant`, `SportEventParticipantSourceData`, and `SportEventParticipantValuation`
  replacing contest-local ownership of imported field identity and default valuation logic

That creates several important mismatches in the current contest model.

## Decisions Locked In This Review

The following direction is now considered settled for the first pass:

- `Contest` references exactly one `SportEvent` through a strong `sportEventId`
- first pass contest model is explicitly single-event only
- `Contest.seasonId` should be removed
- `Contest.sport` should not be denormalized if it can be derived from `SportEvent`
- `Contest.isImported` and `Contest.importedBy` should be removed
- `ContestEntry` should move from `leagueMembershipId` to `squadId`
- `ContestEntry` should include required `entryNumber`
- multiple entries per squad are supported by the model
- `ContestEntry` should support lifecycle state with `ACTIVE` / `INACTIVE`
- entry deletion/leaving should be soft-delete/inactivation, not hard delete
- `ContestConfiguration` should be a separate object/table from `Contest`
- `ContestConfiguration` should include:
  - `locksAt`
  - `minimumEntries`
  - selection/scoring/payout/draft rules
- `minimumEntries` is entry-based, not squad-based, and defaults to `2`
- `Contest` should not move to live state until minimum active entries are met
- `SportEvent` owns real-world timing and status
- `Contest` should have persisted lifecycle state including at least:
  - `NOT_STARTED`
  - `LOCKED`
  - `IN_PROGRESS`
  - `COMPLETED`
- `LOCKED` is a real contest status between `locksAt` and event start
- `RosterPick`, `ContestPick`, `DraftPick`, and `BracketPrediction` remain entry-owned
- `ContestPool` and `ContestParticipantPool` should be removed in the first pass
- the full official event field comes from `SportEventParticipant`
- default PoolMaster values come from `SportEventParticipantValuation`
- event-specific live/final result detail remains in `SportEventParticipantSourceData` for now
- contest history and results should reference `squadId`, not `leagueMembershipId`
- no extra contest-summary persistence concept is needed; summary views remain DTO/read-model concerns
- no snapshot model is required in the first pass for squad/co-manager display state

## Key Mismatches Identified

### 1. Contest entry is member-owned instead of squad-owned

Today:

- `ContestEntry.leagueMembershipId`
- DTOs expose `leagueMembershipId`, `ownerId`, and `ownerDisplayName`
- service logic creates entries from the current user membership directly

Why this conflicts:

- Plan 37 defines `Squad` as the primary contest-entry concept
- co-managers are not supported by direct member ownership
- entry naming currently defaults to member display name instead of squad identity
- current unique constraint enforces one entry per member, not one-or-more entries per squad according to contest rules

### 2. Contest still depends on `Season`

Today:

- `Contest.seasonId`
- create DTO still accepts `seasonId`

Why this conflicts:

- Plan 37 removes tenant-owned season
- season/year should live on global `SportEvent`
- contests should attach to event context, not maintain a parallel season model

### 3. Event relationship is split and weaker than it should be

Today:

- contest create accepts `eventId`
- `Contest` itself does not own `eventId`
- `ContestPool` owns `eventId`
- `ContestMatchup` and `ContestPick` also carry optional `eventId`

Why this conflicts:

- Plan 37 wants `SportEvent` to be the strong global boundary
- contest/event linkage is currently indirect and uneven
- event-backed contests should likely relate directly to `SportEvent`

### 4. Contest-local participant pool duplicates future global event-field concepts

Today:

- `ContestParticipantPool` stores:
  - `ranking`
  - `cost`
  - `tier`
  - availability state
- pricing and tier services derive values directly into that contest-local table

Why this conflicts:

- Plan 37 introduces:
  - `SportEventParticipant`
  - `SportEventParticipantSourceData`
  - `SportEventParticipantValuation`
- current contest pool mixes:
  - imported/global facts
  - PoolMaster valuation
  - contest-specific availability/exclusion state

### 5. Contest pool exclusions contradict the simplified first-pass model

Today:

- `ContestPool.excludedParticipantIds`
- pool service supports exclusion and removal

Why this conflicts:

- Plan 37 currently says first pass should use the full official event field
- exclusions were intentionally deferred as a later enhancement

### 6. Selection configuration is very broad and multi-mode in one table

Today:

- one `SelectionConfig` table stores settings for:
  - snake
  - tiered
  - budget
  - open selection
  - survivor
  - bracket / pick'em

Why this matters:

- the create contract currently only exposes a smaller supported subset
- the persistence model already anticipates deferred/unsupported modes
- this may be fine, but it could also preserve more surface area than the current product really needs

### 7. Contest history and analytics are member-centric

Today:

- `ContestResult` denormalizes `leagueMembershipId`
- `PayoutHistory` stores `leagueMembershipId`
- history services, analytics, export services, and merge logic key heavily off `leagueMembershipId`

Why this conflicts:

- once squads become the contest-playing unit, many historical views should likely key off `squadId`
- member-centric history may not reflect co-managed squads correctly

### 8. Naming still assumes “team” rather than squad

Today:

- `TeamRosterHistory`
- comments referring to “team” and “entry owner”

Why this matters:

- domain terminology should converge once `Squad` is introduced

## Questions For Review

### A. Contest identity and event relationship

1. If a contest is event-backed, should matchups and picks reference `SportEvent` or `SportEventParticipant` more explicitly instead of carrying loose optional UUIDs?

### B. Contest configuration model

2. Do we want to keep one broad `SelectionConfig` table for all contest modes, or replace it with a cleaner `ContestConfiguration` model tailored to the supported modes?
3. Since the current create contract only supports a subset of modes, should the persistence model also narrow to that subset for now?
4. Should `contestType` remain on the model if the product is effectively standardizing on one main contest type for the foreseeable future?
5. What exactly should `isExclusive` mean after squads replace direct member entries:
   - exclusive picks across all entries in the contest
   - exclusive picks only within a squad
   - something else?
6. Should entry-fee and payout settings remain contest-local only, or do we anticipate reusable league-level payout templates as a first-class model?

### C. Entry and squad alignment

7. Should `ContestEntry.name` remain a human-editable field, with default naming based on squad name plus entry number?
8. When an invite is accepted, should squad creation/joining ever happen in the same flow, or should invites remain league-only in the first pass?
9. If a squad becomes inactive after entering a contest, should existing contest entries remain active history records with the inactive squad attached?
10. Should a contest ever allow multiple squads with the same co-managers, or should league rules discourage that even if the schema allows it?

### D. One-entry-per-squad vs multiple entries

11. Should `ContestConfiguration` get an explicit rule like `maxEntriesPerSquad`, and should its default remain `1`?
12. If `maxEntriesPerSquad > 1`, should those entries be separately named by the commissioner/co-managers, or automatically numbered?
13. Should some contest types permanently disallow multiple entries regardless of league or contest settings?

### E. Pool, pricing, and valuation alignment

14. Should contest pricing and tiers always default from `SportEventParticipantValuation`, with no contest-level participant overrides in the first pass?
15. Does budget/tier derivation need valuation versioning later, even though first pass assumes valuations are immutable once established?

### F. Drafting and pick ownership

16. Once entries are squad-owned, should any active squad co-manager be able to draft and submit picks?
17. Do we need to record which specific user made each draft pick or contest pick for audit/history?
18. If co-managers can both act, do we need optimistic locking or stronger “last writer wins” rules around live draft actions and lineup changes?

### G. History, standings, and payouts

19. Should `ContestStanding` and `ContestResult` become squad-centric in their denormalized history fields, or avoid denormalization in the first pass and reference `squadId` only?
20. Should `PayoutHistory` key off `squadId` instead of `leagueMembershipId` once squads are the contest entrants?
21. Should all-time history and analytics primarily be:
   - squad-centric
   - member-centric
   - both
22. If both, which one is the primary user-facing story in the product?
23. Should current member-merge/history services be redesigned around users, league memberships, squads, or some combination?

### H. Terminology and cleanup

24. Should `TeamRosterHistory` be renamed to `SquadRosterHistory` when the new model lands?
25. Should “owner” language in entry DTOs and standings DTOs be replaced with squad-oriented language such as:
   - `squadId`
   - `squadName`
   - `managerDisplayNames`
26. Should contest DTOs continue exposing member identity at all once squads are the primary entry unit?

## Recommended Direction So Far

Based on the current model review and the decisions already locked in Plan 37, the strongest early recommendations are:

- `Contest` should eventually own a strong `sportEventId`
- `Contest.seasonId` should be retired
- `ContestEntry` should move from `leagueMembershipId` to `squadId`
- entry display should become squad-centric rather than owner-centric
- multiple entries should be modeled as a contest rule, not a membership or squad exception
- global event-field and valuation models should absorb the responsibilities currently held by `ContestPool` and `ContestParticipantPool`
- history, payout, and analytics models need a deliberate pass because they are heavily member-centric today

## Suggested Next Review Sequence

To keep the next conversation focused, review the questions in this order:

1. contest-to-event relationship
2. `ContestEntry -> Squad` transition
3. multiple entries per squad rule
4. valuation/pool alignment
5. history and payout redesign
