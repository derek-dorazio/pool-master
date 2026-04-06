# Plan 40 Companion: Draft Room And Selection User Cases

## Purpose

Capture the product use cases and UI-facing workflow notes for live and slow draft
rooms, lineup editing, and selection behavior that emerged during the Plan 38 model
review. This document is intentionally focused on product flows and app behavior, not
on persistence design.

Bracket contest design is intentionally out of scope here and deferred to a later
dedicated bracket feature pass.

## Primary Actors

- League Commissioner
- Squad Co-Manager
- System

## Draft Session Cases

### DR-001: Commissioner starts a snake draft

Actor:
- League Commissioner

Goal:
- launch a turn-based draft for a contest

Flow:
1. Commissioner opens the contest draft controls.
2. System validates that the contest uses a turn-based selection mode.
3. System creates or activates a `DraftSession`.
4. Draft room opens with the current entry on the clock.

Notes:
- `DraftSession` is runtime state, not a configuration snapshot
- draft mode and timing rules come from `ContestConfiguration`
- first-pass session state should stay lean and avoid unnecessary configuration duplication

### DR-002: Commissioner configures a live snake draft

Actor:
- League Commissioner

Goal:
- configure a fast synchronized draft where everyone is online together

Flow:
1. Commissioner selects `selectionType = SNAKE`.
2. Commissioner chooses a live draft style.
3. Commissioner configures a short per-pick timer such as 90 seconds.
4. Contest configuration is saved.

Notes:
- timer configuration belongs on `ContestConfiguration`
- the draft room reads current configuration at runtime
- no persisted draft end time is required

### DR-003: Commissioner configures a slow snake draft

Actor:
- League Commissioner

Goal:
- configure a turn-based draft that runs across many hours or days

Flow:
1. Commissioner selects `selectionType = SNAKE`.
2. Commissioner chooses a slow draft style.
3. Commissioner configures a long per-pick timer such as 8 hours, or no timer.
4. Contest configuration is saved.

Notes:
- this is still a snake draft with turn state
- the difference is operational timing, not ownership or scoring
- if no timer is configured, the draft room should behave without a countdown deadline

### DR-004: Commissioner updates draft timing after the draft has started

Actor:
- League Commissioner

Goal:
- adjust the timer policy while the draft room is active

Flow:
1. Commissioner updates the draft timing fields on `ContestConfiguration`.
2. Draft room refreshes current configuration.
3. Draft room applies the revised timing behavior.

Notes:
- this is an application behavior concern, not a persistence denormalization requirement
- the model should continue reading timing rules from `ContestConfiguration`

## Pick Execution Cases

### DR-005: Entry makes a live draft pick

Actor:
- Squad Co-Manager

Goal:
- submit a pick while the entry is on the clock

Flow:
1. Draft room shows the current entry on the clock.
2. Co-manager selects an available `SportEventParticipant`.
3. Backend records a `DraftPick` for that `ContestEntry`.
4. Draft room advances to the next entry.

Notes:
- picks are entry-owned, not squad-global
- exclusivity checks operate on `SportEventParticipant`

### DR-006: Co-managers overlap in a live draft

Actor:
- Squad Co-Managers

Goal:
- avoid duplicate picks without adding special persistence complexity

Flow:
1. Two co-managers may both be present in the draft room.
2. The first successful selection records the pick and advances the draft.
3. Later duplicate attempts are rejected because the turn has advanced or the participant is no longer available.

Notes:
- no special concurrency model is required in persistence for the first pass
- draft room UX may later restrict or warn about multiple co-managers acting at once
- last write wins is acceptable for first-pass non-locked entry edits

### DR-007: Draft auto-pick triggers after timer expiry

Actor:
- System

Goal:
- keep the draft moving when a timed selection window expires

Flow:
1. Current entry does not make a pick before the timer expires.
2. Application applies the configured auto-pick policy.
3. Backend records the pick and advances the draft.

Notes:
- auto-pick behavior is an application concern
- this should work for both live and slow snake drafts when a timer exists

## Non-Snake Selection Cases

### DR-008: Budget and tiered entries lock at contest lock time

Actor:
- Squad Co-Manager

Goal:
- edit a non-turn-based entry until the contest locks

Flow:
1. Co-manager opens the entry.
2. Co-manager edits roster selections while the contest is unlocked.
3. Once `locksAt` passes, entry changes are blocked.

Notes:
- this behavior is driven by `ContestConfiguration`
- no `DraftSession` is required for these non-turn-based modes

### DR-009: Selected participant later withdraws

Actor:
- System and Squad Co-Manager

Goal:
- preserve the selection while letting scoring rules handle the consequence

Flow:
1. Entry already contains a selected `SportEventParticipant`.
2. Real-world event updates mark that participant inactive or withdrawn.
3. Entry selection remains unchanged.
4. Scoring rules determine the resulting score impact.

Notes:
- picks should not be deleted or invalidated after the fact

### DR-010: Commissioner performs add/drop after a snake draft

Actor:
- League Commissioner

Goal:
- make an administrative roster correction after the draft has completed

Flow:
1. Commissioner opens entry management for a locked snake-draft contest.
2. Commissioner removes one `RosterPick`.
3. Commissioner adds a replacement `RosterPick`.
4. Standard audit timestamps record when those changes occurred.

Notes:
- no special add/drop history model is required in the first pass
- this remains a straightforward roster mutation performed by commissioner tooling

## Open Product Questions

1. Should the draft room explicitly show which co-manager made the latest action, even if that is not yet persisted in the core model?
2. Should commissioners be able to pause and resume live and slow drafts from the same control surface?
3. Should the draft room expose a stronger warning when a commissioner changes timer settings mid-draft?
