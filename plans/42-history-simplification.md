# Plan 42: History Simplification

## Purpose

Simplify PoolMaster's history model so that first-pass history is derived from
the core contest model instead of relying on a separate archival subsystem.

This plan follows the contest-entry, squad, roster, and prize simplification
decisions in [Plan 38](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review.md)
and the product definition captured in
[Plan 41 Companion: Contest History User Cases](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/41-contest-history-user-cases.md).

## First-Pass History Definition

History should primarily answer:

- how entries finished in a contest
- which prizes they won
- which participants they selected
- how those participants performed in the event

History should **not** require a separate result, payout, roster-snapshot, or
analytics persistence layer in the first pass.

## First-Pass Source Of Truth

The primary history source of truth should be:

- `Contest`
- `ContestEntry`
- `RosterPick`
- `ContestEntryPrizeAward`
- `SportEventParticipant`
- `SportEventParticipantSourceData`

## Current Model Problems

The current history model is too large and too tied to the previous member- and
season-centric design.

Examples:

- `ContestStanding` duplicates live entry state
- `ContestResult` duplicates final entry state and denormalizes legacy fields
- `TeamRosterHistory` duplicates the locked entry roster
- `PayoutHistory` duplicates prize outcomes that should live on `ContestEntryPrizeAward`
- many history services key off `leagueMembershipId` rather than `ContestEntry`
  or `Squad`
- records, rivalry, YoY, trophy, and season-summary features are mixed into the
  same subsystem even though they are optional future analytics features

## Locked Simplification Direction

The following direction is considered settled for the first pass:

- `ContestEntry` is the canonical live and final contest-entry record
- `RosterPick` is the canonical historical source of the selected participants
- `ContestEntryPrizeAward` is the canonical historical source of prize outcomes
- participant performance history should be read from `SportEventParticipantSourceData`
- contest history should be primarily focused on reviewing past contests and
  contest prizes
- historical squad name/icon/manager snapshots are out of scope
- separate archival/result/payout/roster-history persistence should be avoided
  in the first pass

## Models To Remove Or Defer

These models should be removed from the first-pass core design or explicitly
deferred:

- `ContestStanding`
- `ContestResult`
- `TeamRosterHistory`
- `PayoutHistory`
- `ScoringCheckpoint`
- `LeagueRecord`
- `RivalryRecord`
- `LeagueSeasonSummary`
- `Trophy`
- `SeasonNote`

## Services And Features To Defer

The following history-adjacent capabilities should be deferred as future
feature work and should not drive current implementation choices:

- rivalry analytics
- all-time records
- champion rollups
- year-over-year summaries
- season recaps
- trophy systems
- payout acknowledgement workflows
- roster replay snapshots
- retention policy for archived result tables
- export formats built around frozen legacy history rows

## Implementation Guidance

When implementing first-pass history:

- read completed-contest standings directly from `ContestEntry`
- read entry rosters directly from `RosterPick`
- read entry prizes directly from `ContestEntryPrizeAward`
- read participant performance from `SportEventParticipantSourceData`
- keep history entry-centric and squad-aware

Avoid:

- creating duplicate final-result tables
- creating duplicate payout-history tables
- creating duplicate roster-history tables
- introducing member-centric historical ownership as the primary contest-history model

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 42-001 | 1 | Align history definition with Plan 41 and Plan 38 simplified contest model | Pending | History means past contests, prizes, rosters, and event performance |
| 42-002 | 1 | Remove `ContestStanding` from the target first-pass contest/history model | Pending | `ContestEntry` owns live/final standing data |
| 42-003 | 1 | Remove `ContestResult` from the target first-pass contest/history model | Pending | final results come from `ContestEntry` |
| 42-004 | 1 | Remove `TeamRosterHistory` from the target first-pass contest/history model | Pending | `RosterPick` is the historical source of truth |
| 42-005 | 1 | Remove `PayoutHistory` from the target first-pass contest/history model | Pending | `ContestEntryPrizeAward` replaces payout/history need |
| 42-006 | 1 | Defer `ScoringCheckpoint` until a proven checkpoint/history use case exists | Pending | not needed for first-pass contest review |
| 42-007 | 2 | Defer records, rivalries, trophies, season summaries, and related analytics from core history implementation | Pending | keep them from influencing first-pass model changes |
| 42-008 | 2 | Redesign history routes and DTOs around `ContestEntry`, `RosterPick`, and `ContestEntryPrizeAward` | Pending | remove member-centric assumptions |
| 42-009 | 2 | Update documentation and plans so agents do not reintroduce removed history tables | Pending | keep use-case and implementation docs aligned |

## Acceptance Criteria

- first-pass history can be explained entirely from core contest data
- completed contest review does not require `ContestResult`, `PayoutHistory`, or `TeamRosterHistory`
- historical contest review is entry-centric and squad-aware
- deferred analytics/history features are clearly documented as non-blocking
