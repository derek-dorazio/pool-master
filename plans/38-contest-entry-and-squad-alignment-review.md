# Plan 38: Contest, Entry, And Squad Alignment Review

## Purpose

Capture the current contest/configuration/entry model, compare it against the emerging
league-first and squad-first domain direction in [Plan 37](./37-league-top-level-domain-and-data-simplification.md),
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
- prize-related behavior is currently embedded in payout configuration rather than a dedicated prize-award model

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
- `ContestEntry` should carry canonical live and final entry state for the first pass:
  - `totalScore`
  - `standingsPosition`
  - `isEliminated`
- `ContestConfiguration` should be a separate object/table from `Contest`
- `ContestConfiguration` should include:
  - `locksAt`
  - `minimumEntries`
  - selection/scoring/payout/draft rules
- `ContestConfiguration` should also include contest prize definitions through a dedicated configuration concept such as `ContestPrizeDefinition`
- `minimumEntries` is entry-based, not squad-based, and defaults to `2`
- `Contest` should not move to live state until minimum active entries are met
- `SportEvent` owns real-world timing and status
- `Contest` should have persisted lifecycle state including at least:
  - `NOT_STARTED`
  - `LOCKED`
  - `IN_PROGRESS`
  - `COMPLETED`
- `LOCKED` is a real contest status between `locksAt` and event start
- `RosterPick` remains the canonical entry-owned selection record for the first pass
- `BracketPrediction` remains only as a minimal entry-owned placeholder while full bracket design is deferred
- `ContestPool` and `ContestParticipantPool` should be removed in the first pass
- `ContestStanding` should be removed in the first pass
- `ContestResult` should be removed in the first pass
- `PayoutHistory` should be removed in the first pass
- `TeamRosterHistory` should be removed in the first pass
- `ContestPick` should be removed in the first pass because season-long / periodic pick contests are out of scope
- the full official event field comes from `SportEventParticipant`
- default PoolMaster values come from `SportEventParticipantValuation`
- event-specific live/final result detail remains in `SportEventParticipantSourceData` for now
- draft and selection availability should come directly from `SportEventParticipant` plus `SportEventParticipantValuation`
- `RosterPick` should remain the only roster persistence for tiered, budget, and open-selection modes
- `RosterPick` should be the canonical selected-participant record for a `ContestEntry`
- `RosterPick` should reference `sportEventParticipantId`
- `RosterPick` should be unique on `(entryId, sportEventParticipantId)`
- `RosterPick` should not carry `selectionSource`, lifecycle state, or a dedicated selection timestamp beyond standard audit timestamps
- `RosterPick` changes before lock should hard-delete and replace rows rather than soft-delete them
- `DraftPick` should be replaced conceptually by `DraftPickHistory`
- `DraftPickHistory` should exist only for snake-draft replay/history and should reference the resulting `RosterPick`
- `DraftPickHistory` should include:
  - `draftSessionId`
  - `rosterPickId`
  - `entryId`
  - `pickNumber`
  - `round`
  - `pickInRound`
  - `autoPicked`
- `DraftPickHistory` should rely on standard audit timestamps rather than a dedicated `pickedAt`
- `DraftPickHistory` should not duplicate `sportEventParticipantId`
- `BracketPrediction` should associate only to `ContestEntry`
- `BracketPrediction` should remove the direct `Contest` association as redundant
- `BracketPrediction` should keep its JSON payload opaque for now
- bracket-specific prediction structure, winner identity shape, and full bracket workflow are explicitly deferred to a later dedicated design pass
- `DraftSession` should remain a persisted entity for turn-based drafts, especially snake drafts
- `DraftSession` should store runtime state only, not duplicated configuration
- live and slow snake drafts are both supported
- draft mode/style and timing rules belong on `ContestConfiguration`
- `DraftSession` should replace `pickDeadline` with `currentTurnStartedAt`
- exclusive contests should prevent the same `SportEventParticipant` from being selected by more than one entry in the contest
- non-exclusive contests should allow the same `SportEventParticipant` on many entries
- if a selected `SportEventParticipant` later becomes inactive or withdrawn, the pick remains valid and scoring rules handle the consequence
- no separate actor/audit field is required on draft or selection persistence in the first pass
- no special persistence-level concurrency model is required for co-manager draft actions in the first pass
- commissioner add/drop after a snake draft should be a simple `RosterPick` create/delete operation
- contest outcome and history should reference `squadId`, not `leagueMembershipId`
- prize wins should be represented by an entry-owned award relationship such as `ContestEntryPrizeAward`
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
- `ContestMatchup` and legacy pick objects also carry optional `eventId`

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
6. Should prize definitions be modeled explicitly inside `ContestConfiguration`, such as top 3 prizes or last-place prize rules, instead of treating payout behavior as a generic opaque config blob?
7. Should entry-fee and payout settings remain contest-local only, or do we anticipate reusable league-level prize templates as a first-class model?

### C. Entry and squad alignment

8. Should `ContestEntry.name` remain a human-editable field, with default naming based on squad name plus entry number?
9. When an invite is accepted, should squad creation/joining ever happen in the same flow, or should invites remain league-only in the first pass?
10. If a squad becomes inactive after entering a contest, should existing contest entries remain active history records with the inactive squad attached?
11. Should a contest ever allow multiple squads with the same co-managers, or should league rules discourage that even if the schema allows it?

### D. One-entry-per-squad vs multiple entries

12. Should `ContestConfiguration` get an explicit rule like `maxEntriesPerSquad`, and should its default remain `1`?
13. If `maxEntriesPerSquad > 1`, should those entries be separately named by the commissioner/co-managers, or automatically numbered?
14. Should some contest types permanently disallow multiple entries regardless of league or contest settings?

### E. Pool, pricing, and valuation alignment

15. Should contest pricing and tiers always default from `SportEventParticipantValuation`, with no contest-level participant overrides in the first pass?
16. Does budget/tier derivation need valuation versioning later, even though first pass assumes valuations are immutable once established?

### F. Drafting and pick ownership

17. When bracket design is revisited later, should the JSON payload remain opaque or be normalized into explicit bracket prediction items?

### G. Prizes, standings, and history

19. Should `ContestEntry` be the only canonical live/final result record in the first pass, with no separate `ContestStanding` or `ContestResult` tables?
20. Should `ContestEntryPrizeAward` support multiple prize awards per entry in the first pass?
21. Is the minimal first-pass `ContestEntryPrizeAward` shape enough as:
   - `entryId`
   - `prizeName`
   - `winningAmount`
or do we already need more structure like rank criteria or prize type?
22. Should all-time history and analytics primarily be:
   - squad-centric
   - member-centric
   - both
23. If both, which one is the primary user-facing story in the product?
24. Should current member-merge/history services be redesigned around users, league memberships, squads, or some combination?

### H. Terminology and cleanup

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
- `ContestEntry` should likely become the single canonical live/final entry record in the first pass
- multiple entries should be modeled as a contest rule, not a membership or squad exception
- global event-field and valuation models should absorb the responsibilities currently held by `ContestPool` and `ContestParticipantPool`
- `RosterPick` should become the single canonical non-bracket selection record
- `DraftPickHistory` should exist only for snake-draft replay/history and should reference `RosterPick`
- draft and roster availability should come from the event field plus global valuation, not contest-local pool tables
- `BracketPrediction` should be preserved only as a minimal shell until brackets are designed as a focused feature set later
- prize rules belong in contest configuration, and entry prize awards should attach directly to entries
- history and analytics models need a deliberate pass because they are heavily member-centric today

## Suggested Next Review Sequence

To keep the next conversation focused, review the questions in this order:

1. contest-to-event relationship
2. `ContestEntry -> Squad` transition
3. multiple entries per squad rule
4. valuation/pool alignment
5. history and payout redesign
