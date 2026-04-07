# Plan 53 Companion: Commissioner Tools Contest Management Use Cases

## Purpose

Capture the commissioner-facing use cases for creating, configuring, updating,
and operating contests.

This document is intended to complement:

- [plans/38-contest-entry-and-squad-alignment-review.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review.md)
- [plans/39-sport-event-import-and-status-propagation-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/39-sport-event-import-and-status-propagation-user-cases.md)
- [plans/44-league-first-commissioner-administration-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/44-league-first-commissioner-administration-user-cases.md)
- [plans/51-scoring-and-participant-data-review.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/51-scoring-and-participant-data-review.md)
- [plans/52-potential-rules-function-expansion.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/52-potential-rules-function-expansion.md)

It focuses specifically on commissioner workflows, not member entry-building
flows.

## Primary Actors

- League Commissioner
- Root Admin acting as Super-Commissioner
- League Member
- System / Scoring Engine

## Core Principles

- contest management belongs in commissioner tools
- contests are always league-scoped
- first pass contests are single-event only
- contest configuration is owned by `ContestConfiguration`
- commissioner-configured scoring uses:
  - `ParticipantContestScoringRule`
  - `ContestEntryAggregationRule`
  - `ContestPrizeDefinition`
- members build entries inside the guardrails set by the commissioner

## Contest Setup Use Cases

### CCM-001: Commissioner creates a contest from an imported sport event

Actor:
- League Commissioner

Goal:
- create a contest tied to one real-world `SportEvent`

Flow:
1. Commissioner opens contest creation in the active league.
2. Commissioner browses or searches available `SportEvent` records.
3. Commissioner selects one `SportEvent`.
4. Backend creates:
   - `Contest`
   - `ContestConfiguration`
5. Contest is now ready for further configuration.

Notes:
- first pass is explicitly one `Contest` to one `SportEvent`
- the commissioner should not have to create or own event data manually

### CCM-002: Commissioner chooses the contest selection type

Actor:
- League Commissioner

Goal:
- define how entries select participants

Examples:
- `SNAKE_DRAFT`
- `TIERED`
- `BUDGET_PICK`
- `OPEN_SELECTION` if later enabled

Flow:
1. Commissioner opens contest configuration.
2. Commissioner selects the desired `selectionType`.
3. Backend persists the selection type on `ContestConfiguration`.

Notes:
- some selection types may remain disabled in first pass
- the selected `selectionType` informs entry-building and draft-room behavior

### CCM-003: Commissioner configures roster size or selection limits

Actor:
- League Commissioner

Goal:
- define how many participants an entry must or may select

Examples:
- pick 6 golfers
- pick 8 NCAA tournament teams
- pick 5 drivers

Flow:
1. Commissioner opens contest configuration.
2. Commissioner sets the roster size or selection-count rule.
3. Backend stores that rule in `ContestConfiguration`.
4. Member entry creation and validation enforce that rule.

Notes:
- the exact shape can stay flexible in configuration for now
- this is distinct from scoring and aggregation

### CCM-004: Commissioner configures maximum entries per squad

Actor:
- League Commissioner

Goal:
- control how many entries one squad may create in the contest

Flow:
1. Commissioner opens contest configuration.
2. Commissioner sets `maxEntriesPerSquad`.
3. Backend stores the value on `ContestConfiguration`.
4. Entry creation validates against the configured limit.

Notes:
- this complements, but is distinct from, `minimumEntries`

### CCM-005: Commissioner configures contest lock timing

Actor:
- League Commissioner

Goal:
- decide when entries stop being editable

Flow:
1. Commissioner opens contest configuration.
2. Commissioner chooses a lock rule or explicit lock datetime.
3. UI resolves the commissioner input into `locksAt`.
4. Backend stores `locksAt` on `ContestConfiguration`.

Notes:
- `LOCKED` is a persisted contest status
- lock timing is commissioner-owned, not provider-owned

### CCM-006: Commissioner configures minimum active entries

Actor:
- League Commissioner

Goal:
- require enough active entries before a contest can move forward

Flow:
1. Commissioner opens contest configuration.
2. Commissioner sets `minimumEntries`.
3. Backend persists the value.
4. Contest lifecycle logic checks the threshold before live-state transition.

## Scoring Configuration Use Cases

### CCM-007: Commissioner chooses participant scoring rules for the contest

Actor:
- League Commissioner

Goal:
- define which participant-level rules contribute points

Examples for first pass:
- `GOLF_RELATIVE_TO_PAR_TOTAL`
- `TEAM_WIN_POINTS`
- `ROUND_MULTIPLIER`
- `SEED_DIFFERENTIAL_BONUS`

Flow:
1. Commissioner opens scoring configuration.
2. System shows the available participant scoring definitions allowed for the contest type.
3. Commissioner selects one or more scoring definitions.
4. Backend creates `ParticipantContestScoringRule` rows under `ContestConfiguration`.

Notes:
- rule implementations are owned by the code-level `ParticipantScoringDefinitionRegistry`
- commissioner picks from supported definitions; commissioners do not author arbitrary rule code

### CCM-008: Commissioner orders participant scoring rules

Actor:
- League Commissioner

Goal:
- define the execution order for participant scoring rules

Flow:
1. Commissioner views the selected scoring rules.
2. Commissioner reorders them.
3. Backend persists `sortOrder` on `ParticipantContestScoringRule`.

Notes:
- first-pass rules may not all depend on order, but the model should support ordered execution

### CCM-009: Commissioner configures rule-specific parameters

Actor:
- League Commissioner

Goal:
- tune a participant scoring rule for the contest

Examples:
- points per win
- round multiplier table
- seed-differential behavior
- golf missed-cut penalty setting later if added

Flow:
1. Commissioner selects one configured participant scoring rule.
2. Commissioner edits its parameters.
3. Backend stores the rule config JSON on `ParticipantContestScoringRule`.

### CCM-010: Commissioner enables or disables a configured participant scoring rule

Actor:
- League Commissioner

Goal:
- toggle a scoring rule without deleting it

Flow:
1. Commissioner opens configured scoring rules.
2. Commissioner deactivates or reactivates a rule.
3. Backend updates the `active` flag.

Notes:
- this supports experimentation and later correction flows

### CCM-011: Commissioner chooses the entry aggregation rule

Actor:
- League Commissioner

Goal:
- define how participant score totals roll up into `ContestEntry.totalScore`

Examples for first pass:
- `SUM_ALL_ENTRIES`
- `SUM_TOP_N_ENTRIES`

Flow:
1. Commissioner opens scoring configuration.
2. Commissioner selects an entry aggregation rule.
3. Backend creates or updates the one active `ContestEntryAggregationRule` for the contest.

Notes:
- first pass supports exactly one active aggregation rule per contest

### CCM-012: Commissioner configures aggregation parameters

Actor:
- League Commissioner

Goal:
- supply the aggregation rule’s contest-specific parameters

Examples:
- `topN = 4`
- `lowerIsBetter = true`

Flow:
1. Commissioner selects the aggregation rule.
2. Commissioner edits the rule parameters.
3. Backend stores the config JSON on `ContestEntryAggregationRule`.

Examples:
- pick 6 golfers, use top 4 scores
- sum all teams in an NCAA team pool

## Prize Configuration Use Cases

### CCM-013: Commissioner chooses which prize definitions apply to the contest

Actor:
- League Commissioner

Goal:
- select enabled prize rules for the contest

Examples:
- first place
- second place
- third place
- last place
- leader after round 1

Flow:
1. Commissioner opens prize configuration.
2. System shows supported prize definitions for the contest type.
3. Commissioner selects which prize definitions to enable.
4. Backend creates `ContestPrizeDefinition` rows.

Notes:
- prize implementations are owned by the code-level `PrizeDefinitionRegistry`

### CCM-014: Commissioner configures prize payout settings

Actor:
- League Commissioner

Goal:
- define what each prize pays or displays

Examples:
- fixed amount
- percentage of total pool

Flow:
1. Commissioner edits a configured contest prize definition.
2. Commissioner sets payout type, amount, and/or percentage.
3. Backend persists the explicit payout fields.

### CCM-015: Commissioner configures prize rule parameters

Actor:
- League Commissioner

Goal:
- define rule-specific prize behavior

Examples:
- leader after round 1
- closest tiebreaker score

Flow:
1. Commissioner selects a configured prize definition.
2. Commissioner edits rule-specific parameters.
3. Backend stores `ruleConfig` JSON on `ContestPrizeDefinition`.

### CCM-016: Commissioner configures an optional total prize pool

Actor:
- League Commissioner

Goal:
- provide a contest-level prize pool amount for display or percentage resolution

Flow:
1. Commissioner opens prize configuration.
2. Commissioner enters an optional total pool amount.
3. Backend stores the optional contest-level prize pool amount on `ContestConfiguration`.

Notes:
- the system does not process payments
- this is display/configuration metadata only

## Contest Operation Use Cases

### CCM-017: Commissioner reviews contest entry readiness before lock

Actor:
- League Commissioner

Goal:
- see whether the contest is ready to lock and run

Flow:
1. Commissioner opens contest management.
2. System shows:
   - number of active entries
   - configured minimum entries
   - configured max entries per squad
   - lock timing
   - selection type
   - scoring rules
   - aggregation rule
   - prize definitions

### CCM-018: Commissioner adjusts contest configuration before lock

Actor:
- League Commissioner

Goal:
- change setup safely before the contest becomes locked

Flow:
1. Commissioner opens contest configuration before `locksAt`.
2. Commissioner edits allowed settings.
3. Backend validates the edit against current contest state.
4. Updated configuration is persisted.

Notes:
- exact edit restrictions can be refined later
- first pass principle: configuration is commissioner-owned until contest lock

### CCM-019: Commissioner cannot change contest structure after lock without a correction workflow

Actor:
- League Commissioner

Goal:
- preserve locked contest integrity

Flow:
1. Commissioner attempts to change a locked contest’s structural configuration.
2. Backend rejects direct structural edits or routes them to a correction workflow later.

Notes:
- future correction tooling can be designed separately

## Member-Facing Outcome Use Cases

### CCM-020: Member sees contest rules before creating an entry

Actor:
- League Member

Goal:
- understand how to build an entry and how it will be scored

Flow:
1. Member opens contest detail.
2. System displays:
   - selection type
   - roster size / pick limits
   - max entries allowed
   - scoring rules summary
   - aggregation summary
   - prize summary
   - lock timing

### CCM-021: Member entry validation follows the configured contest rules

Actor:
- League Member

Goal:
- ensure entry building respects commissioner-defined limits

Flow:
1. Member creates or edits an entry.
2. Backend validates against `ContestConfiguration`.
3. Entry save succeeds only if the current configuration rules are satisfied.

Examples:
- cannot pick more than 6 golfers
- cannot create a third entry if `maxEntriesPerSquad = 2`
- cannot edit after contest is locked

## System Use Cases

### CCM-022: Scoring subsystem uses commissioner-configured participant scoring rules

Actor:
- System / Scoring Engine

Goal:
- compute participant score events from configured scoring rules

Flow:
1. Scoring subsystem loads active `ParticipantContestScoringRule` rows for the contest.
2. Scoring subsystem resolves the code implementation from `ParticipantScoringDefinitionRegistry`.
3. Scoring subsystem applies those rules to participant data.
4. System writes:
   - `ContestEntryParticipantScoreEvent`
   - `ContestEntryParticipantScore`

### CCM-023: Scoring subsystem uses the commissioner-configured aggregation rule

Actor:
- System / Scoring Engine

Goal:
- compute `ContestEntry.totalScore` using the configured aggregation method

Flow:
1. System loads the one active `ContestEntryAggregationRule`.
2. System resolves the implementation from `EntryAggregationFunctionRegistry`.
3. System computes `ContestEntry.totalScore` from participant totals.
4. System updates standings position and prize logic as needed.

### CCM-024: Prize subsystem uses configured contest prize definitions

Actor:
- System / Scoring Engine

Goal:
- determine when prize awards should be created, updated, or revoked

Flow:
1. System loads active `ContestPrizeDefinition` rows.
2. System resolves prize logic from `PrizeDefinitionRegistry`.
3. System evaluates contest state and standings.
4. System writes or updates `ContestEntryPrizeAward` rows.

## Notes For Future Expansion

- additional participant scoring rules should be reviewed through
  [plans/52-potential-rules-function-expansion.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/52-potential-rules-function-expansion.md)
- bracket, pick'em, and survivor configuration should get their own later use-case pass
- commissioner correction workflows should be designed separately from first-pass contest setup
