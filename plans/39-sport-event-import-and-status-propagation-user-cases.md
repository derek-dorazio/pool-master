# Sport Event Import And Status Propagation User Cases

## Purpose

This document captures the intended user cases and system flows for imported
`SportEvent` lifecycle management and how real-world event state should propagate
into PoolMaster contest state, standings, and entry summaries.

It is intentionally written as a use-case precursor so later backend and UI plans
can build on it without re-deriving the workflow.

## Primary Actors

- Data Import Scheduler
- Sport Data Provider
- Sport Event Import Worker
- Contest Update Subscriber
- League Member
- League Commissioner

## Core Principle

Real-world sports data should drive `SportEvent` state.

PoolMaster contests that reference a `SportEvent` should react to that state
through internal event propagation and subscribers, rather than copying or
manually re-entering the real-world lifecycle.

First-pass scope:

- single-event contests only
- no scheduler/import-module design decisions beyond what is required to shape the domain events

## Event Lifecycle Model

Target `SportEvent` lifecycle:

- `NOT_STARTED`
- `IN_PROGRESS`
- `COMPLETED`

Imported updates should also refresh:

- participant/event-field state
- participant result data
- scores, strokes, wins/losses, placements, or equivalent sport-specific facts

## User Cases

### IM-001: Scheduler imports a future sport event before it starts

Actor:
- Data Import Scheduler

Goal:
- keep upcoming event metadata and field composition current before the event begins

Flow:
1. Scheduler runs on a configured cadence.
2. Import worker fetches current event data from the provider.
3. Backend creates or updates the `SportEvent`.
4. Backend updates `SportEventParticipant` and related source data.
5. `SportEvent.status` remains `NOT_STARTED`.

### IM-002: Scheduler marks a sport event as in progress

Actor:
- Data Import Scheduler

Goal:
- reflect that the real-world event has started

Flow:
1. Scheduler runs after the real event start.
2. Provider reports the event as started/live/in progress.
3. Backend updates `SportEvent.status` from `NOT_STARTED` to `IN_PROGRESS`.
4. Backend emits `SportingEventStatusChangedEvent`.

### IM-003: Scheduler updates participant result data during an in-progress event

Actor:
- Data Import Scheduler

Goal:
- keep the live event state and participant performance current

Examples:
- golf strokes / position / cut status
- team wins/losses / scoreline
- fight outcome progress
- race results in progress

Flow:
1. Scheduler runs repeatedly during the live event.
2. Import worker fetches updated provider data.
3. Backend updates:
   - `SportEvent`
   - `SportEventParticipant`
   - `SportEventParticipantSourceData`
4. Backend may emit `SportingEventParticipantDataChangedEvent` for meaningful single-participant changes when that lower-level stream is helpful.

Notes:
- event-specific live/final result detail remains in `SportEventParticipantSourceData` for the first pass

### IM-003A: Scheduler completes one import pass for a sporting event

Actor:
- Data Import Scheduler

Goal:
- signal that one full participant-data refresh for a single sporting event is complete

Flow:
1. Import worker finishes updating participant data for one `SportEvent`.
2. Backend emits `SportingEventParticipantDataImportCompletedEvent`.
3. Downstream subscribers use that event to refresh contest scoring and standings once per import pass.

### IM-004: Scheduler marks a sport event as completed

Actor:
- Data Import Scheduler

Goal:
- finalize the event and stop treating it as live

Flow:
1. Scheduler runs after the provider reports the event as finished.
2. Backend updates final event and participant result data.
3. Backend changes `SportEvent.status` to `COMPLETED`.
4. Backend emits `SportingEventStatusChangedEvent`.

## Contest Propagation Cases

### IM-005: Contest subscriber reacts when event becomes in progress

Actor:
- Contest Update Subscriber

Goal:
- move PoolMaster contests into the correct lifecycle state when the underlying event starts

Flow:
1. Subscriber receives `SportEvent` status-change event.
2. Subscriber finds contests referencing that `SportEvent`.
3. Subscriber updates contest status appropriately:
   - `NOT_STARTED`
   - `LOCKED`
   - `IN_PROGRESS`
   - `COMPLETED`
4. Subscriber triggers any required recalculation or read-model refresh.

Notes:
- the principle is that event start drives contest live-state transition
- `LOCKED` is a PoolMaster-specific contest status between `locksAt` and event start

### IM-006: Contest subscriber reacts to live event updates

Actor:
- Contest Update Subscriber

Goal:
- keep standings, summary scores, and entry-related views current while the event is live

Flow:
1. Subscriber receives `SportingEventParticipantDataImportCompletedEvent`.
2. Subscriber loads contests tied to that `SportEvent`.
3. Subscriber recalculates or refreshes:
   - standings
   - entry summary score
   - `standingsPosition`
   - `ContestEntry` elimination state where applicable
4. Updated read models become visible in the product.

Notes:
- payout projections are out of scope
- dashboard aggregates should remain read-model/UI concerns, not persisted aggregates

### IM-007: Contest subscriber reacts when event completes

Actor:
- Contest Update Subscriber

Goal:
- finalize contest outcomes and end-of-event read models

Flow:
1. Subscriber receives `SportEvent` completion event.
2. Subscriber updates contest status to its completed/finalized state.
3. Subscriber computes final standings and results.
4. Subscriber updates entry summaries and results.

## User-Facing Outcomes

### IM-008: League member sees live contest standings update during an event

Actor:
- League Member

Goal:
- watch contest progress based on current real-world data

Flow:
1. Member opens contest standings or scoring view.
2. Backend serves read models updated by the subscriber flow.
3. Member sees current ranking and score movement.

### IM-009: Commissioner sees contest transition automatically as event starts and ends

Actor:
- League Commissioner

Goal:
- avoid manually advancing contest lifecycle to match the real-world event

Flow:
1. Commissioner creates a contest tied to a `SportEvent`.
2. Import/scheduler updates the `SportEvent` over time.
3. Contest state transitions automatically through subscriber logic.

## Design Notes

- `SportEvent` owns real-world event lifecycle and timing.
- Contests should subscribe to `SportEvent` changes rather than duplicating that lifecycle manually.
- Live scoring and standings updates should be driven by event/participant updates, not ad hoc polling logic embedded in contest code paths.
- This model fits the earlier decision to remove contest-owned `startsAt` / `endsAt` and keep contest-specific locking rules in `ContestConfiguration`.
- `Contest.status` is persisted and should include a `LOCKED` state in addition to the real-world event lifecycle states.
- `ContestEntry` owns canonical entry-level state such as `totalScore`, `standingsPosition`, and elimination state.

## Deferred Implementation Questions

1. What scheduler cadence should apply before start, during live play, and after completion?
2. Which single-participant changes should emit `SportingEventParticipantDataChangedEvent`, and which should remain internal to the import pass?
3. Should standings recomputation remain direct in the subscriber, or later move to a queued scoring/read-model worker?
