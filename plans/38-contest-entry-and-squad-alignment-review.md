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

1. Should every contest in the first-pass model require a `SportEvent`, or can some contests remain eventless/manual?
2. Should `Contest` own `sportEventId` directly instead of relying on `ContestPool.eventId`?
3. Should `Contest.seasonId` be removed entirely once `SportEvent.seasonYear` is in place?
4. Should `Contest.sport` remain denormalized on the contest, or should it always derive from `SportEvent.sport` when an event is attached?
5. If a contest is event-backed, should matchups and picks reference `SportEvent` or `SportEventParticipant` more explicitly instead of carrying loose optional UUIDs?

### B. Contest configuration model

6. Do we want to keep one broad `SelectionConfig` table for all contest modes, or split configuration by supported mode family?
7. Since the current create contract only supports a subset of modes, should the persistence model also narrow to that subset for now?
8. Should `contestType` remain on the model if the product is effectively standardizing on one main contest type for the foreseeable future?
9. What exactly should `isExclusive` mean after squads replace direct member entries:
   - exclusive picks across all entries in the contest
   - exclusive picks only within a squad
   - something else?
10. Should entry-fee and payout settings remain contest-local only, or do we anticipate reusable league-level payout templates as a first-class model?

### C. Entry and squad alignment

11. Should `ContestEntry` reference `squadId` directly and drop `leagueMembershipId` entirely?
12. Should `ContestEntry` keep a human-editable `name`, or should the entry display name simply come from the squad name in the first pass?
13. If squads are the primary entry concept, should a squad always exist before entering a contest, or should contest-entry flow be able to create the squad inline?
14. When an invite is accepted, should squad creation/joining ever happen in the same flow, or should invites remain league-only in the first pass?
15. If a squad becomes inactive after entering a contest, should existing contest entries remain active history records with the inactive squad attached?
16. Should a contest ever allow multiple squads with the same co-managers, or should league rules discourage that even if the schema allows it?

### D. One-entry-per-squad vs multiple entries

17. Should `Contest` get an explicit rule like `maxEntriesPerSquad` with default `1`?
18. If `maxEntriesPerSquad > 1`, should those entries be separately named by the commissioner/co-managers, or automatically numbered?
19. If a squad has multiple entries in the same contest, should picks/drafts be fully independent per entry? The current model suggests yes.
20. Should some contest types permanently disallow multiple entries regardless of league or contest settings?

### E. Pool, pricing, and valuation alignment

21. Should `ContestParticipantPool` survive only as a contest-local availability/override table once `SportEventParticipant` and valuations exist?
22. Should contest pricing and tiers default from `SportEventParticipantValuation` and only write contest-local overrides when needed?
23. Do we want contest-local overrides for:
   - `contestPrice`
   - `contestTier`
   - participant availability
   - entry limits
24. If the first pass uses the full official event field with no exclusions, should `ContestPool` become simpler or even optional for some modes?
25. Should availability/injury/withdrawal state remain global at the `SportEventParticipant` level, with contest-local override only for special cases?
26. Does budget/tier derivation need valuation versioning so a contest can say which valuation set it used?

### F. Drafting and pick ownership

27. Once entries are squad-owned, should any active squad co-manager be able to draft and submit picks?
28. Do we need to record which specific user made each draft pick or contest pick for audit/history?
29. Should draft-room turn ownership remain entry-based, or does the new squad model imply a separate squad-turn concept? My read is entry-based is still fine.
30. If co-managers can both act, do we need optimistic locking or stronger “last writer wins” rules around live draft actions and lineup changes?

### G. History, standings, and payouts

31. Should `ContestStanding` and `ContestResult` become squad-centric in their denormalized history fields?
32. Should `PayoutHistory` key off `squadId` instead of `leagueMembershipId` once squads are the contest entrants?
33. Should all-time history and analytics primarily be:
   - squad-centric
   - member-centric
   - both
34. If both, which one is the primary user-facing story in the product?
35. Should current member-merge/history services be redesigned around users, league memberships, squads, or some combination?

### H. Terminology and cleanup

36. Should `TeamRosterHistory` be renamed to `SquadRosterHistory` when the new model lands?
37. Should “owner” language in entry DTOs and standings DTOs be replaced with squad-oriented language such as:
   - `squadId`
   - `squadName`
   - `managerDisplayNames`
38. Should contest DTOs continue exposing member identity at all once squads are the primary entry unit?

## Recommended Direction So Far

Based on the current model review and the decisions already locked in Plan 37, the strongest early recommendations are:

- `Contest` should eventually own a strong `sportEventId`
- `Contest.seasonId` should be retired
- `ContestEntry` should move from `leagueMembershipId` to `squadId`
- entry display should become squad-centric rather than owner-centric
- multiple entries should be modeled as a contest rule, not a membership or squad exception
- global event-field and valuation models should absorb more of what `ContestParticipantPool` currently owns
- history, payout, and analytics models need a deliberate pass because they are heavily member-centric today

## Suggested Next Review Sequence

To keep the next conversation focused, review the questions in this order:

1. contest-to-event relationship
2. `ContestEntry -> Squad` transition
3. multiple entries per squad rule
4. valuation/pool alignment
5. history and payout redesign
