# Plan 51: Scoring And Participant Data Review

## Purpose

Define the first-pass scoring and participant-data model for PoolMaster after
the league, squad, contest, entry, pick, history, billing, administration, and
notification simplifications.

This plan assumes the new contest model direction is already accepted and
focuses on:

- event-scoped participant data
- contest scoring inputs
- concrete scoring function families
- participant data shapes
- scoring update flow

This plan intentionally follows the simpler scoring direction:

- one shared scoring interface
- a small number of explicit scoring functions
- family-specific configuration
- focused unit tests

It does **not** propose a fully declarative "new config automatically creates a
new scoring system" architecture.

## Locked Scoring Direction

The following is the active recommendation for first pass:

- use a common scoring interface
- implement explicit scoring functions for major scoring families
- keep participant data loosely shaped overall, but strongly type critical normalized fields
- allow family-specific scoring config shapes
- score from current event participant state, not only incremental stat deltas
- trigger rescoring from import completion / participant refresh events
- write canonical score state back to `ContestEntry`

## Assumed Alignment Changes

These are the non-negotiable contest-model alignment changes that should be
carried through as part of the same refactor.

- `ContestEntry.leagueMembershipId` -> `ContestEntry.squadId`
- add required `ContestEntry.entryNumber`
- replace `ContestEntry.rank` with `ContestEntry.standingsPosition`
- add `ContestEntry.status = ACTIVE | INACTIVE`
- keep `ContestEntry.totalScore`
- keep `ContestEntry.isEliminated`
- remove `ContestStanding`
- remove `ContestResult`
- remove `PayoutHistory`
- remove `TeamRosterHistory`
- remove `ContestPool`
- remove `ContestParticipantPool`
- remove `ContestPick`
- keep `BracketPrediction` only as a minimal deferred placeholder owned by `ContestEntry`
- move `Contest` to `sportEventId`
- remove `Contest.seasonId`
- remove `Contest.sport`
- remove `Contest.isImported`
- remove `Contest.importedBy`
- separate `ContestConfiguration` from `Contest`
- move contest lock rules to `ContestConfiguration`
- keep `Contest.status` persisted and include `LOCKED`
- keep first pass single-event only
- make `RosterPick` the canonical selection record
- change `RosterPick.participantId` -> `RosterPick.sportEventParticipantId`
- keep `DraftSession`
- replace `DraftSession.pickDeadline` with `DraftSession.currentTurnStartedAt`
- rename `DraftPick` to `DraftPickHistory`
- make `DraftPickHistory` reference `RosterPick`
- `BracketPrediction.contestId` should be removed
- `BracketPrediction` should relate only to `ContestEntry`
- `ContestEntryPrize` should exist as an entry-owned prize record
- `ContestPrize` should live in `ContestConfiguration`

## Current Model Problems

The current implementation still has several structural issues:

- scoring is tied to raw participant ids rather than event-scoped participant identity
- scoring depends on `ContestParticipantPool`, which the target model removes
- `StatEvent` delta processing is treated as the primary scoring input
- `ScoreStore` and `ContestStanding` duplicate state that should live on `ContestEntry`
- the shared scoring config is trying to cover many contest families through one mostly stat-rule-oriented abstraction
- the codebase still lacks:
  - `SportEventParticipant`
  - `SportEventParticipantSourceData`
  - `SportEventParticipantValuation`

## Recommended Target Model

### Real-world event layer

#### SportEvent

Owns the real-world event identity, timing, and lifecycle:

- `id`
- `sport`
- `name`
- `startDateTime`
- `endDateTime`
- `status`
- metadata

#### SportEventParticipant

Canonical event-scoped participant identity used by contest picks and scoring.

Recommended fields:

- `id`
- `sportEventId`
- `participantId`
- `status`
- `position?`
- `isCut?`
- `isEliminated?`
- `advanced?`
- `metadata`
- timestamps

This is the record that `RosterPick` should reference.

#### SportEventParticipantSourceData

Stores provider-specific and normalized result payloads for one event
participant.

Recommended fields:

- `id`
- `sportEventParticipantId`
- `providerId`
- `externalId`
- `rawPayload`
- `normalizedData`
- `receivedAt`
- timestamps

Notes:

- `rawPayload` preserves provider truth
- `normalizedData` gives the scoring subsystem a stable payload to read
- heterogeneous sport-specific fields belong here

#### SportEventParticipantValuation

This remains useful conceptually, but is not the focus of this plan.

It should eventually own:

- price
- tier
- order / ranking

for event-specific selection contexts like budget or tiered contests.

## Contest-Side Scoring Model

### Contest

Minimal contest identity and lifecycle:

- `leagueId`
- `sportEventId`
- `status`

### ContestConfiguration

Owns scoring and selection configuration.

For scoring, recommended fields:

- `selectionType`
- `scoringFamily`
- `scoringConfig`
- `minimumEntries`
- `locksAt`

Possible `scoringFamily` values:

- `ADVANCEMENT`
- `STAT_ACCUMULATION`
- `STROKE`
- `POSITION`
- `PREDICTION`

### ContestEntry

Canonical live and final score record.

Recommended scoring fields:

- `totalScore`
- `standingsPosition`
- `isEliminated`
- `status`

### RosterPick

Canonical selected participant list for an entry.

Recommended fields:

- `entryId`
- `sportEventParticipantId`

Scoring should resolve:

- `ContestEntry`
  -> `RosterPick`
  -> `SportEventParticipant`
  -> `SportEventParticipantSourceData`

## Recommended Scoring Architecture

### Core wrapper

Use a shared scoring interface that dispatches to an explicit scoring function.

Example sketch:

```ts
interface ScoreContestEntryContext {
  contest: Contest;
  configuration: ContestConfiguration;
  entry: ContestEntry;
  rosterPicks: RosterPick[];
  participants: SportEventParticipant[];
  sourceData: SportEventParticipantSourceData[];
}

interface ScoreContestEntryResult {
  totalScore: number;
  standingsPosition?: number;
  isEliminated?: boolean;
  participantBreakdowns: ParticipantScoreBreakdown[];
}

type ScoreContestEntryFn = (
  context: ScoreContestEntryContext,
) => ScoreContestEntryResult;

function scoreContestEntry(context: ScoreContestEntryContext): ScoreContestEntryResult {
  switch (context.configuration.scoringFamily) {
    case 'STROKE':
      return scoreStrokeEntry(context);
    case 'POSITION':
      return scorePositionEntry(context);
    case 'ADVANCEMENT':
      return scoreAdvancementEntry(context);
    case 'STAT_ACCUMULATION':
      return scoreStatAccumulationEntry(context);
    case 'PREDICTION':
      return scorePredictionEntry(context);
    default:
      throw new Error(`Unsupported scoring family`);
  }
}
```

### Why this approach

Pros:

- easy to understand
- easy to unit test
- honest about heterogeneous sports
- adding a new sport or contest family is straightforward
- avoids building and maintaining a complex declarative rules language

Cons:

- less generic than a fully declarative engine
- some logic duplication across scoring families
- requires code changes to add new families

This tradeoff is acceptable because:

- new sports and contest families are not expected frequently
- simple, explicit, tested functions are easier to maintain

## Proposed Scoring Function Catalog

### 1. `scoreStrokeEntry`

Use for:

- golf stroke pools
- any lower-is-better total event

Reads:

- `scoreToPar`
- `strokes`
- `madeCut`
- `withdrew`
- `position`

Config shape:

```ts
interface StrokeScoringConfig {
  countingMethod: 'ALL' | 'BEST_N';
  bestN?: number;
  missedCutPolicy: 'USE_SCORE' | 'PENALTY_SCORE' | 'EXCLUDE';
  missedCutPenaltyScore?: number;
  lowerIsBetter: true;
}
```

Participant data shape example:

```ts
interface StrokeParticipantData {
  scoreToPar?: number;
  strokes?: number;
  madeCut?: boolean;
  withdrew?: boolean;
  position?: number;
  roundScores?: number[];
}
```

### 2. `scorePositionEntry`

Use for:

- horse racing
- F1 / NASCAR position-driven pools
- any finish-position point table

Reads:

- `position`
- `dnf`
- optionally supporting stats like `lapsLed`, `fastestLap`

Config shape:

```ts
interface PositionScoringConfig {
  positionPoints: Record<number, number>;
  dnfPolicy?: 'ZERO' | 'LAST_PLACE' | 'PENALTY';
  bonuses?: {
    lapsLed?: number;
    fastestLap?: number;
    stageWin?: number;
  };
}
```

Participant data shape example:

```ts
interface PositionParticipantData {
  position?: number;
  dnf?: boolean;
  lapsLed?: number;
  fastestLap?: number;
  stageWins?: number;
}
```

### 3. `scoreAdvancementEntry`

Use for:

- team playoff pools
- tennis tournament advancement pools
- outcome/wins-based contests

Reads:

- `wins`
- `losses`
- `seriesWins`
- `roundReached`
- `advanced`

Config shape:

```ts
interface AdvancementScoringConfig {
  pointsPerWin?: number;
  roundValues?: number[];
  roundReachedPoints?: Record<string, number>;
  lossesPenalty?: number;
}
```

Participant data shape example:

```ts
interface AdvancementParticipantData {
  wins?: number;
  losses?: number;
  seriesWins?: number;
  roundReached?: string;
  advanced?: boolean;
}
```

### 4. `scoreStatAccumulationEntry`

Use for:

- NFL fantasy
- NBA fantasy
- soccer fantasy
- tennis stat-based variants

Reads:

- normalized stat totals

Config shape:

```ts
interface StatAccumulationConfig {
  statWeights: Record<string, number>;
  bonusRules?: Array<{
    stat: string;
    operator: 'gte' | 'gt' | 'eq';
    value: number;
    points: number;
  }>;
  penaltyRules?: Array<{
    stat: string;
    pointsPerUnit: number;
  }>;
}
```

Participant data shape example:

```ts
interface StatAccumulationParticipantData {
  stats: Record<string, number>;
}
```

### 5. `scorePredictionEntry`

Use for:

- pick'em
- survivor
- bracket

Status:

- likely deferred from first pass because `ContestPick` has already been removed
- bracket remains a deferred feature

Config shape example:

```ts
interface PredictionScoringConfig {
  pointsPerCorrect?: number;
  roundValues?: number[];
  confidenceWeighted?: boolean;
  upsetBonus?: 'NONE' | 'SEED_DIFFERENCE' | 'SEED_MULTIPLIER';
}
```

Participant data shape example:

- this family is less roster-based and more matchup/prediction based
- it likely belongs in a later focused design pass

## Candidate Normalized Participant Data Shapes

This section proposes a small set of family-level data shapes that scoring
functions can consume after reading `normalizedData` from
`SportEventParticipantSourceData`.

### Common shell

```ts
interface CommonParticipantResult {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'WITHDRAWN' | 'ELIMINATED';
  position?: number;
  advanced?: boolean;
  isCut?: boolean;
  isEliminated?: boolean;
}
```

### Stroke / Golf

```ts
interface GolfParticipantResult extends CommonParticipantResult {
  scoreToPar?: number;
  strokes?: number;
  madeCut?: boolean;
  roundScores?: number[];
}
```

### Advancement / Team or Tournament

```ts
interface AdvancementParticipantResult extends CommonParticipantResult {
  wins?: number;
  losses?: number;
  seriesWins?: number;
  roundReached?: string;
}
```

### Position / Racing

```ts
interface PositionParticipantResult extends CommonParticipantResult {
  lapsLed?: number;
  fastestLap?: number;
  placeDifferential?: number;
}
```

### Stat Accumulation

```ts
interface StatParticipantResult extends CommonParticipantResult {
  stats: Record<string, number>;
}
```

## Launch Support Recommendation

Recommended first-pass scoring families:

- `STROKE`
- `POSITION`
- `ADVANCEMENT`
- `STAT_ACCUMULATION`

Deferred:

- `PREDICTION`
- full bracket scoring
- survivor / pick'em-specific scoring

## Event And Scoring Flow

### Recommended flow

1. Import updates `SportEvent` and `SportEventParticipantSourceData`
2. Import emits:
   - `SportingEventStatusChangedEvent` when status changes
   - `SportingEventParticipantDataChangedEvent` for low-level participant changes if useful
   - `SportingEventParticipantDataImportCompletedEvent` after one event import pass
3. Scoring subscriber handles `SportingEventParticipantDataImportCompletedEvent`
4. Subscriber finds affected contests for that `SportEvent`
5. Subscriber rescales / recomputes each affected `ContestEntry` from:
   - `RosterPick`
   - `SportEventParticipant`
   - `SportEventParticipantSourceData`
   - `ContestConfiguration`
6. Subscriber updates:
   - `ContestEntry.totalScore`
   - `ContestEntry.standingsPosition`
   - `ContestEntry.isEliminated`
7. Prize logic may award `ContestEntryPrize` if relevant

## Recommendations Outside Scoring Logic

- add `SportEventParticipant`
- add `SportEventParticipantSourceData`
- keep heterogeneous normalized JSON on source data
- keep a small strongly typed common participant result shell
- remove contest-local participant pool assumptions from scoring
- remove `ScoreStore` as source of truth
- write canonical score state directly to `ContestEntry`
- use current participant state for corrections and rescoring

## Review Questions

### Data model

1. Should `SportEventParticipant` include a small normalized common shell with:
   - `status`
   - `position`
   - `advanced`
   - `isCut`
   - `isEliminated`
   while sport-specific detail lives in `SportEventParticipantSourceData.normalizedData`?

2. Should `SportEventParticipantSourceData` store both:
   - `rawPayload`
   - `normalizedData`
   for every provider update?

3. Should `RosterPick` always reference `sportEventParticipantId`, never raw `participantId`?

### Scoring architecture

4. Should scoring always recompute a full affected entry from current participant state, rather than applying score deltas?

5. Should `ContestConfiguration` use:
   - `scoringFamily`
   - family-specific `scoringConfig`
   rather than one universal all-purpose scoring schema?

6. Is the proposed family split correct:
   - `STROKE`
   - `POSITION`
   - `ADVANCEMENT`
   - `STAT_ACCUMULATION`
   - `PREDICTION`
   or do you want a different grouping?

### Launch scope

7. Which scoring families do you want at launch?

8. Should `PREDICTION` scoring remain fully deferred until bracket / pick'em gets a dedicated design pass?

9. For golf launch, do you want to support only:
   - stroke / score-to-par / cut / position data
   and explicitly defer per-hole fantasy scoring?

10. For team playoff contests, is this enough canonical normalized data for launch:
    - wins
    - losses
    - seriesWins
    - roundReached
    - advanced

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 51-001 | 1 | Capture non-negotiable contest/scoring alignment changes | Done | Assumed throughout this plan |
| 51-002 | 1 | Replace declarative-first scoring direction with shared interface + explicit scoring functions | Done | Option B selected |
| 51-003 | 1 | Define target event-participant and source-data model for scoring inputs | Pending | `SportEventParticipant` and `SportEventParticipantSourceData` |
| 51-004 | 1 | Confirm family-level scoring-function catalog and launch scope | Pending | Stroke, position, advancement, stat accumulation |
| 51-005 | 2 | Redesign `ContestConfiguration` scoring shape around family-specific config | Pending | Replace universal scoring assumption |
| 51-006 | 2 | Remove score-store / standings-table assumptions from target model | Pending | Canonical state lives on `ContestEntry` |
| 51-007 | 3 | Defer bracket / pick'em scoring to a later focused design pass unless promoted | Pending | Not part of first-pass launch by default |

## Acceptance Criteria

- scoring direction is based on a shared interface plus explicit scoring functions
- participant selection references event-scoped participants
- heterogeneous event data is handled through `SportEventParticipantSourceData`
- launch scoring families are identified
- deferred scoring families are explicitly called out
