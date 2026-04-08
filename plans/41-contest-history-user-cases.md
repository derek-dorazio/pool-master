# Plan 41 Companion: Contest History User Cases

## Purpose

Capture the first-pass product meaning of "history" for PoolMaster after the
contest, squad, roster, and prize model simplification work.

This document is intentionally narrow:

- history is primarily about reviewing past contests
- history is primarily about reviewing past contest prizes
- history should come from the core contest model, not from a separate archival
  subsystem

This document should guide future backend and UI work so that agents do not
reintroduce unnecessary result, payout, roster-history, or analytics tables
while the core model is still being simplified.

## Primary Actors

- League Member
- Squad Co-Manager
- League Commissioner
- System

## First-Pass History Definition

In the first pass, "history" means:

- reviewing completed contests
- reviewing how entries finished
- reviewing which prizes entries won
- reviewing which participants were on an entry
- reviewing how those participants performed in the real event

History does **not** require a separate frozen history subsystem in the first
pass. It should be derived from the core contest model.

## Source Of Truth For History

First-pass contest history should come from:

- `Contest`
  - contest identity and completed status
- `ContestEntry`
  - final `standingsPosition`
  - final `totalScore`
  - elimination state where relevant
- `RosterPick`
  - the participants chosen for the entry
- `ContestEntryPrizeAward`
  - the prizes won by the entry
- `SportEventParticipant`
  - event-scoped participant identity
- `SportEventParticipantSourceData`
  - live/final participant performance data imported from the real event

## User Cases

### H-000: Member opens the history view of completed contests

Actor:
- League Member

Goal:
- browse the list of completed contests for the current league

Flow:
1. Member opens contest history.
2. System loads completed contests for the league.
3. UI shows a list of finished contests that can be opened for detail.

Notes:
- this is the second major contest-browsing view alongside the active contests view
- it is not a public discovery feature

### H-001: Member reviews completed contest standings

Actor:
- League Member

Goal:
- see how entries finished in a completed contest

Flow:
1. Member opens a completed contest.
2. System loads `ContestEntry` records for that contest.
3. Entries are ordered by `standingsPosition`.
4. UI shows entry name, squad, score, standing, and prize summary.

Notes:
- first-pass history is entry-centric
- no separate `ContestResult` table is required

### H-002: Member reviews prizes won in a contest

Actor:
- League Member

Goal:
- see which entries won which prizes

Flow:
1. Member opens a completed contest.
2. System loads `ContestEntryPrizeAward` records for entries in that contest.
3. UI shows the prize labels and winning amounts attached to the winning entries.

Notes:
- prize amounts are descriptive only
- PoolMaster is not transacting money
- no separate `PayoutHistory` table is required

### H-003: Member reviews an entry's chosen participants

Actor:
- League Member

Goal:
- inspect which participants an entry selected

Flow:
1. Member opens a completed contest entry.
2. System loads `RosterPick` records for the entry.
3. UI resolves those picks to `SportEventParticipant`.
4. UI shows the selected participants as the final contest roster.

Notes:
- `RosterPick` is the historical source of truth for entry composition
- no separate roster snapshot table is required in the first pass

### H-004: Member reviews how selected participants performed

Actor:
- League Member

Goal:
- understand why an entry scored the way it did

Flow:
1. Member opens a completed contest entry.
2. System resolves each `RosterPick` to its `SportEventParticipant`.
3. System loads the related `SportEventParticipantSourceData`.
4. UI shows event performance data alongside the chosen participants.

Notes:
- event performance remains on the event side of the model
- history should consume that data rather than duplicating it

### H-005: Commissioner reviews past contests without extra history tables

Actor:
- League Commissioner

Goal:
- manage and review past contest outcomes using the same core model as member history

Flow:
1. Commissioner opens a past contest.
2. System loads the completed `Contest`, `ContestEntry`, `RosterPick`, and `ContestEntryPrizeAward` data.
3. Commissioner reviews final standings, rosters, and prizes.

Notes:
- first-pass history should not depend on separate result or payout persistence

## Deferred History Features

The following ideas are explicitly deferred and should not drive first-pass
model or implementation choices:

- head-to-head rivalry tracking
- all-time matchup summaries
- trophies and badges
- season summaries
- year-over-year analytics
- record books
- power, luck, or consistency rankings
- frozen roster replay snapshots
- payout acknowledgement tracking
- historical squad name/icon/manager snapshots
- specialized archival/export tables

These may be designed later as focused features, but they are not part of the
first-pass definition of contest history.

## Implementation Guidance

Agents implementing first-pass history-related functionality should prefer:

- `Contest`
- `ContestEntry`
- `RosterPick`
- `ContestEntryPrizeAward`
- `SportEventParticipant`
- `SportEventParticipantSourceData`

Agents should avoid introducing or depending on:

- `ContestResult`
- `ContestStanding`
- `TeamRosterHistory`
- `PayoutHistory`
- derived analytics/history tables

unless a later plan explicitly reintroduces them.
