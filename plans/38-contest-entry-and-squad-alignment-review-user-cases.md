# Plan 38 Companion: Contest, Entry, And Squad Alignment User Cases

## Purpose

This companion document captures the product use cases and user flows behind
[Plan 38](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review.md).

It is intended to bridge the backend/model review into future UI and workflow design.

## Primary Actors

- League Commissioner
- League Member
- Squad Co-Manager
- System/Scoring Engine

## Contest Creation And Configuration Cases

### CT-001: Commissioner creates a contest from a global event

Actor:
- League Commissioner

Goal:
- create a league contest tied to a real imported sports event

Flow:
1. Commissioner opens contest creation.
2. Commissioner selects a `SportEvent`.
3. Commissioner chooses contest configuration.
4. Backend creates the contest.
5. Contest references the global event directly.

Notes:
- contest should not need a separate tenant-owned `Season`
- first pass contest model is explicitly single-event only

### CT-002: Commissioner configures contest rules

Actor:
- League Commissioner

Goal:
- define how entry construction, drafting, scoring, and payouts work

Examples:
- selection type
- scoring engine
- scoring rules
- payout rules
- lock timing
- minimum active entries
- max entries per squad

Flow:
1. Commissioner selects a contest template or starts from defaults.
2. Commissioner reviews suggested configuration for the sport/contest style.
3. Commissioner adjusts rules as needed.
4. Backend stores the contest configuration.

Notes:
- smart defaults are especially important for common contest archetypes
- example: golf event with a familiar "pick 6, top 4 count" pattern
- `ContestConfiguration` should remain a separate object from `Contest`

### CT-002A: Commissioner configures contest lock timing

Actor:
- League Commissioner

Goal:
- control exactly when PoolMaster entries stop being editable relative to the real-world event

Flow:
1. Commissioner opens contest configuration.
2. System shows the selected `SportEvent` start datetime.
3. Commissioner chooses a lock rule such as:
   - at event start
   - 1 hour before event start
   - 5 minutes before event start
   - custom datetime
4. UI resolves that rule to a concrete `locksAt` datetime.
5. Backend stores the resolved `locksAt` on `ContestConfiguration`.

Notes:
- `SportEvent` owns the real-world event timing
- `ContestConfiguration` owns the contest-specific lock timing
- the UI may present relative choices, but persistence should use a concrete datetime

### CT-002B: Commissioner configures minimum active entries

Actor:
- League Commissioner

Goal:
- require a minimum number of active entries before a contest can move into live play

Flow:
1. Commissioner opens contest configuration.
2. Commissioner sets `minimumEntries`.
3. Backend stores the value on `ContestConfiguration`.
4. Contest cannot move to live state until the minimum active entries threshold is satisfied.

Notes:
- this threshold is entry-based, not squad-based
- first-pass default should be `2`

### CT-003: Commissioner uses sport-specific smart defaults

Actor:
- League Commissioner

Goal:
- create a contest quickly using common patterns

Flow:
1. Commissioner chooses sport and contest mode.
2. System proposes a default configuration.
3. Commissioner accepts or edits it.
4. Contest is created with those defaults.

## Entry And Squad Cases

### CT-004: Squad enters a contest

Actor:
- Squad Co-Manager

Goal:
- create one contest entry for the squad

Flow:
1. Co-manager opens contest entry flow.
2. System verifies the user manages a squad in that league.
3. Backend creates `ContestEntry` with:
   - `contestId`
   - `squadId`
   - `entryNumber = 1`
   - `status = ACTIVE`
4. Entry display name defaults from squad name plus entry number.

### CT-005: Squad enters the same contest multiple times

Actor:
- Squad Co-Manager

Goal:
- create additional entries when contest rules allow it

Flow:
1. Co-manager creates another entry.
2. Backend checks contest rule like `maxEntriesPerSquad`.
3. Backend creates another `ContestEntry` with incremented `entryNumber`.
4. Each entry behaves independently for picks, scores, rank, and results.

### CT-006: First-time user creates squad inline while entering a contest

Actor:
- League Member with no squad yet

Goal:
- enter a contest without first navigating a separate squad-management flow

Flow:
1. Member starts contest entry.
2. System sees no squad for that user in the league.
3. System offers inline squad creation.
4. Backend creates squad and squad membership.
5. Backend creates the first contest entry.

Notes:
- squads may also exist before any contests are created

### CT-007: Co-managers operate on the same squad

Actor:
- Any active Squad Co-Manager

Goal:
- manage contest entries collaboratively

Flow:
1. Co-manager opens squad entries.
2. Co-manager edits roster/picks/draft choices for an entry.
3. Backend checks squad co-management rights.
4. Changes apply to the entry, regardless of which co-manager initiated them.

## Draft And Pick Cases

### CT-008: Entry participates in a draft

Actor:
- Squad Co-Manager

Goal:
- make draft selections for a specific contest entry

Flow:
1. Co-manager opens draft room.
2. Draft turn is associated with a specific `ContestEntry`.
3. Co-manager makes a pick.
4. Pick is stored against the entry.

Notes:
- draft ownership should remain entry-based, not squad-global

### CT-009: Co-managers make picks for different entries

Actor:
- Squad Co-Managers

Goal:
- manage multiple entries for the same squad independently

Flow:
1. Squad has multiple entries in a contest.
2. Each entry has its own picks or roster.
3. Co-managers switch between entries.
4. System keeps picks, scores, and standings separate per entry.

### CT-010: System records who performed an action

Actor:
- System/audit capability

Goal:
- preserve operational traceability even when squads have multiple managers

Potential future flow:
1. Co-manager makes a pick or lineup change.
2. Backend stores the acting `userId` in audit history.
3. Product surfaces action history when needed.

Notes:
- this is likely important later, even if not modeled immediately

## Standings, Results, And Payout Cases

### CT-011: Standings show entries, not squads

Actor:
- League Member

Goal:
- see each contest entry ranked independently

Flow:
1. User opens standings.
2. Backend returns entry-level standings.
3. Each row references the owning squad.

Example:
- same squad can have entry 1 at rank 1 and entry 2 at rank 47

### CT-012: Results and payout history attach to entries owned by squads

Actor:
- System and League Members

Goal:
- preserve final results per entry while showing squad ownership

Flow:
1. Contest closes.
2. Backend computes results per `ContestEntry`.
3. Result and payout records reference the entry and the squad.

### CT-013: Historical displays show current squad identity in first pass

Actor:
- League Member

Goal:
- view contest history without a heavy snapshot model

Flow:
1. User opens past contest results.
2. System resolves squad from current references.
3. UI shows current squad name/state.

Notes:
- historical snapshots can be added later if needed
- first-pass history should resolve current squad/co-manager state

## Configuration And Valuation Cases

### CT-014: Contest uses the full official event field

Actor:
- League Commissioner

Goal:
- avoid contest-specific participant curation in the first pass

Flow:
1. Commissioner creates an event-backed contest.
2. Contest derives its participant field from `SportEventParticipant`.
3. No contest-level participant exclusions are applied.

### CT-015: Contest uses PoolMaster global participant valuation

Actor:
- System and League Commissioner

Goal:
- use one shared price/tier/rank view for an event

Flow:
1. Event participants receive PoolMaster valuation.
2. Contest uses that valuation for budget/tiered entry building.
3. Commissioner configures contest rules around those values, not per-contest participant pricing.

Notes:
- first-pass assumes valuation is effectively immutable once established for the event

## UX Implications

The future web app will likely need:

- commissioner contest-creation wizard
- sport- and contest-type defaults
- squad-aware entry management
- inline squad creation during contest entry
- entry switching for squads with multiple entries
- commissioner configuration for entry limits per squad

The future backend/API will likely need:

- contest create/update endpoints tied to `sportEventId`
- `ContestConfiguration` or equivalent configuration endpoint/model
- squad-aware entry CRUD
- entry-number assignment logic
- squad-aware draft and pick authorization
- standings/results contracts that reference `squadId` instead of member ownership

## Open Product Questions

These remain useful for later refinement:

1. Should `ContestConfiguration` become a renamed/simplified replacement for `SelectionConfig`?
2. Should some contest types always force one entry per squad even if the model supports more?
3. Should contest history eventually snapshot squad display identity or valuation context?
4. How much audit detail should be retained about which co-manager made each action?
