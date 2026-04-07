# Plan 51: Scoring And Participant Data Review

## Purpose

Define the first-pass scoring and participant-data model for PoolMaster after
the league, squad, contest, entry, pick, history, billing, administration, and
notification simplifications.

This plan assumes the new contest model direction is already accepted and
focuses on:

- event-scoped participant data
- contest scoring inputs
- participant scoring rules
- entry aggregation rules
- participant data shapes
- scoring update flow

This plan intentionally follows the simpler scoring direction:

- one shared scoring interface
- a small number of explicit participant scoring rules
- contest-owned scoring-rule definitions
- contest-owned entry aggregation rules
- focused unit tests

It does **not** propose a fully declarative "new config automatically creates a
new scoring system" architecture.

## Locked Scoring Direction

The following is the active recommendation for first pass:

- use a common scoring interface
- implement explicit participant scoring rules
- allow one contest to compose multiple participant scoring rules
- use a separate entry aggregation rule to compute `ContestEntry.totalScore`
- keep participant data loosely shaped overall, but strongly type critical normalized fields
- allow scoring-rule-specific config shapes
- allow aggregation-rule-specific config shapes
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
- `ContestPrizeDefinition` should exist as the contest-owned prize-definition record
- `ContestEntryPrizeAward` should exist as the entry-owned awarded-prize record

## Current Model Problems

The current implementation still has several structural issues:

- scoring is tied to raw participant ids rather than event-scoped participant identity
- scoring depends on `ContestParticipantPool`, which the target model removes
- `StatEvent` delta processing is treated as the primary scoring input
- `ScoreStore` and `ContestStanding` duplicate state that should live on `ContestEntry`
- the shared scoring config is trying to cover many contest types through one mostly stat-rule-oriented abstraction
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
- minimal first-class fields only until implementation proves more commonality
- likely:
  - `status`
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
- relation to `ParticipantContestScoringRule`
- relation to `ContestEntryAggregationRule`
- `minimumEntries`
- `locksAt`

Prize setup should also live under contest configuration through
`ContestPrizeDefinition` rows.

### ContestEntry

Canonical live and final score record.

Recommended scoring fields:

- `totalScore`
- `standingsPosition`
- `isEliminated`
- `status`

### ParticipantContestScoringRule

Contest-specific configured participant scoring rule.

Recommended fields:

- `id`
- `contestConfigurationId`
- `participantScoringDefinitionId`
- `sortOrder`
- `config`
- `active`

Notes:

- `participantScoringDefinitionId` should be a stable enum/id that maps to a code-owned `ParticipantScoringDefinitionRegistry`
- `config` should be JSON
- one contest can compose multiple scoring rules
- each rule evaluates participant-level data and produces participant score events

### ContestEntryAggregationRule

Contest-specific configured entry aggregation rule.

Recommended fields:

- `id`
- `contestConfigurationId`
- `aggregationDefinitionId`
- `config`
- `active`

Notes:

- `aggregationDefinitionId` should be a stable enum/id that maps to a code-owned `EntryAggregationFunctionRegistry`
- the aggregation rule determines how participant totals roll up into `ContestEntry.totalScore`
- first pass likely supports exactly one active aggregation rule per contest

### ContestPrizeDefinition

Contest-specific configured prize definition.

Recommended fields:

- `id`
- `contestConfigurationId`
- `prizeDefinitionId`
- `displayName`
- `sortOrder`
- `ruleConfig`
- payout basics such as:
  - `payoutType`
  - `amount?`
  - `percentage?`
- `active`

Notes:

- `prizeDefinitionId` points to a code-owned `PrizeDefinitionRegistry`
- the registry should expose stable ids, names, descriptions, supported contest types, and function bindings
- `ruleConfig` remains flexible JSON for prize-specific parameters

### ContestEntryPrizeAward

Awarded prize record tied to an entry.

Recommended fields:

- `id`
- `entryId`
- `contestPrizeDefinitionId`
- `awardedAt`
- resolved display/output fields such as:
  - `displayName`
  - `amount?`
  - `percentage?`

Notes:

- awards should point to the contest-configured prize definition row, not directly to the registry id
- one entry may win multiple awards
- awards may happen before contest completion when the prize rule supports it

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

Use a shared scoring interface that applies configured participant scoring rules
and then applies an entry aggregation rule.

Example sketch:

```ts
interface ScoreContestEntryContext {
  contest: Contest;
  configuration: ContestConfiguration;
  entry: ContestEntry;
  rosterPicks: RosterPick[];
  participants: SportEventParticipant[];
  sourceData: SportEventParticipantSourceData[];
  scoringRules: ParticipantContestScoringRule[];
  aggregationRule: ContestEntryAggregationRule;
}

interface ScoreContestEntryResult {
  totalScore: number;
  standingsPosition?: number;
  isEliminated?: boolean;
  participantBreakdowns: ParticipantScoreBreakdown[];
}

type ScoreParticipantRuleFn = (
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
) => ContestEntryParticipantScoreEvent[];

type AggregateEntryScoreFn = (
  context: ScoreContestEntryContext,
  aggregationRule: ContestEntryAggregationRule,
  participantScores: ContestEntryParticipantScore[],
) => number;

function scoreContestEntry(context: ScoreContestEntryContext): ScoreContestEntryResult {
  const scoreEvents = context.scoringRules
    .filter((definition) => definition.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((definition) => {
      switch (definition.participantScoringDefinitionId) {
        case 'GOLF_RELATIVE_TO_PAR_TOTAL':
          return scoreGolfRelativeToParEntry(context, definition);
        case 'TEAM_WIN_POINTS':
          return scoreTeamWinPointsEntry(context, definition);
        case 'ROUND_MULTIPLIER':
          return scoreRoundMultiplierEntry(context, definition);
        case 'SEED_DIFFERENTIAL_BONUS':
          return scoreSeedDifferentialBonusEntry(context, definition);
        case 'FINISH_POSITION_POINTS':
          return scoreFinishPositionEntry(context, definition);
        case 'PLAYER_STAT_POINTS':
          return scorePlayerStatPointsEntry(context, definition);
        case 'PREDICTION':
          return scorePredictionEntry(context, definition);
        default:
          throw new Error(`Unsupported scoring rule`);
      }
    });

  const participantScores = rebuildContestEntryParticipantScores(scoreEvents);
  const totalScore = aggregateContestEntryScore(
    context,
    context.aggregationRule,
    participantScores,
  );

  return {
    totalScore,
    participantBreakdowns: toParticipantBreakdowns(participantScores, scoreEvents),
  };
}
```

### Why this approach

Pros:

- easy to understand
- easy to unit test
- honest about heterogeneous sports
- adding a new scoring rule or aggregation rule is straightforward
- avoids building and maintaining a complex declarative rules language

Cons:

- less generic than a fully declarative engine
- some logic duplication across scoring functions
- requires code changes to add new scoring rules or aggregation rules

This tradeoff is acceptable because:

- new sports and contest types are not expected frequently
- simple, explicit, tested functions are easier to maintain

## TypeScript Reference Sketches

This section is intentionally more concrete so an implementation agent can
start building the scoring module without having to reinterpret the design.

### Registry types

```ts
type ParticipantScoringDefinitionId =
  | 'GOLF_RELATIVE_TO_PAR_TOTAL'
  | 'TEAM_WIN_POINTS'
  | 'ROUND_MULTIPLIER'
  | 'SEED_DIFFERENTIAL_BONUS'
  | 'FINISH_POSITION_POINTS'
  | 'PLAYER_STAT_POINTS'
  | 'PREDICTION';

type AggregationDefinitionId =
  | 'SUM_ALL_ENTRIES'
  | 'SUM_TOP_N_ENTRIES';

interface ParticipantScoringDefinitionRegistryItem {
  id: ParticipantScoringDefinitionId;
  name: string;
  description: string;
  supportedContestTypes: string[];
  scoreParticipant: ScoreParticipantRuleFn;
}

interface EntryAggregationRegistryItem {
  id: AggregationDefinitionId;
  name: string;
  description: string;
  aggregateEntry: AggregateEntryScoreFn;
}
```

### Persisted rule records

```ts
interface ParticipantContestScoringRule {
  id: string;
  contestConfigurationId: string;
  participantScoringDefinitionId: ParticipantScoringDefinitionId;
  sortOrder: number;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ContestEntryAggregationRule {
  id: string;
  contestConfigurationId: string;
  aggregationDefinitionId: AggregationDefinitionId;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Participant score persistence

```ts
interface ContestEntryParticipantScore {
  id: string;
  entryId: string;
  rosterPickId: string;
  pointsEarned: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ContestEntryParticipantScoreEvent {
  id: string;
  contestEntryParticipantScoreId: string;
  participantContestScoringRuleId: string;
  points: number;
  detailsJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Participant result helpers

```ts
function findParticipantResult(
  context: ScoreContestEntryContext,
  rosterPickId: string,
): SportEventParticipantSourceData | undefined {
  const rosterPick = context.rosterPicks.find((pick) => pick.id === rosterPickId);
  if (!rosterPick) return undefined;

  return context.sourceData.find(
    (item) => item.sportEventParticipantId === rosterPick.sportEventParticipantId,
  );
}

function getNormalizedData<T>(
  sourceData: SportEventParticipantSourceData | undefined,
): T | undefined {
  return sourceData?.normalizedData as T | undefined;
}
```

### Launch participant scoring rule implementations

#### `GOLF_RELATIVE_TO_PAR_TOTAL`

```ts
interface GolfRelativeToParRuleConfig {
  missedCutPenaltyPerRound?: number;
}

function scoreGolfRelativeToParEntry(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as GolfRelativeToParRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantResult(context, pick.id);
    const data = getNormalizedData<GolfParticipantResult>(source);
    if (!data) return [];

    const penalty =
      !data.madeCut && config.missedCutPenaltyPerRound
        ? config.missedCutPenaltyPerRound
        : 0;

    const scoreToPar = data.scoreToPar ?? 0;
    const totalPoints = scoreToPar + penalty;

    return [
      {
        id: crypto.randomUUID(),
        contestEntryParticipantScoreId: '',
        participantContestScoringRuleId: scoringRule.id,
        points: totalPoints,
        detailsJson: {
          rosterPickId: pick.id,
          scoreToPar,
          madeCut: data.madeCut ?? null,
          penaltyApplied: penalty,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  });
}
```

#### `TEAM_WIN_POINTS`

```ts
interface TeamWinPointsRuleConfig {
  pointsPerWin: number;
}

function scoreTeamWinPointsEntry(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as TeamWinPointsRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantResult(context, pick.id);
    const data = getNormalizedData<TeamContestParticipantResult>(source);
    if (!data?.wins) return [];

    return [
      {
        id: crypto.randomUUID(),
        contestEntryParticipantScoreId: '',
        participantContestScoringRuleId: scoringRule.id,
        points: data.wins * config.pointsPerWin,
        detailsJson: {
          rosterPickId: pick.id,
          wins: data.wins,
          pointsPerWin: config.pointsPerWin,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  });
}
```

#### `ROUND_MULTIPLIER`

```ts
interface RoundMultiplierRuleConfig {
  basePointsPerWin: number;
  roundMultipliers: Record<string, number>;
}

function scoreRoundMultiplierEntry(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as RoundMultiplierRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantResult(context, pick.id);
    const data = getNormalizedData<TeamContestParticipantResult>(source);
    if (!data?.wins || !data.roundReached) return [];

    const multiplier = config.roundMultipliers[data.roundReached] ?? 1;

    return [
      {
        id: crypto.randomUUID(),
        contestEntryParticipantScoreId: '',
        participantContestScoringRuleId: scoringRule.id,
        points: data.wins * config.basePointsPerWin * multiplier,
        detailsJson: {
          rosterPickId: pick.id,
          wins: data.wins,
          roundReached: data.roundReached,
          basePointsPerWin: config.basePointsPerWin,
          multiplier,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  });
}
```

#### `SEED_DIFFERENTIAL_BONUS`

```ts
interface SeedDifferentialBonusRuleConfig {
  underdogOnly?: boolean;
}

function scoreSeedDifferentialBonusEntry(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as SeedDifferentialBonusRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantResult(context, pick.id);
    const data = getNormalizedData<TeamContestParticipantResult>(source);
    if (!data?.wins || data.seed == null || data.opponentSeed == null) return [];

    const seedDifference = data.seed - data.opponentSeed;
    if (config.underdogOnly && seedDifference <= 0) return [];

    return [
      {
        id: crypto.randomUUID(),
        contestEntryParticipantScoreId: '',
        participantContestScoringRuleId: scoringRule.id,
        points: Math.max(seedDifference, 0),
        detailsJson: {
          rosterPickId: pick.id,
          wins: data.wins,
          seed: data.seed,
          opponentSeed: data.opponentSeed,
          seedDifference,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  });
}
```

### Entry aggregation implementations

#### `SUM_ALL_ENTRIES`

```ts
function aggregateSumAllEntries(
  participantScores: ContestEntryParticipantScore[],
): number {
  return participantScores.reduce((sum, score) => sum + score.pointsEarned, 0);
}
```

#### `SUM_TOP_N_ENTRIES`

```ts
interface SumTopNEntriesConfig {
  topN: number;
  lowerIsBetter?: boolean;
}

function aggregateSumTopNEntries(
  participantScores: ContestEntryParticipantScore[],
  config: SumTopNEntriesConfig,
): number {
  const sorted = [...participantScores].sort((a, b) =>
    config.lowerIsBetter ? a.pointsEarned - b.pointsEarned : b.pointsEarned - a.pointsEarned,
  );

  return sorted
    .slice(0, config.topN)
    .reduce((sum, score) => sum + score.pointsEarned, 0);
}
```

### Rebuild pattern

```ts
function rebuildContestEntryParticipantScores(
  entryId: string,
  rosterPicks: RosterPick[],
  scoreEvents: ContestEntryParticipantScoreEvent[],
): ContestEntryParticipantScore[] {
  return rosterPicks.map((pick) => {
    const pointsEarned = scoreEvents
      .filter((event) => {
        const rosterPickId = event.detailsJson.rosterPickId;
        return rosterPickId === pick.id;
      })
      .reduce((sum, event) => sum + event.points, 0);

    return {
      id: crypto.randomUUID(),
      entryId,
      rosterPickId: pick.id,
      pointsEarned,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
}
```

## Proposed Participant Scoring Rule Catalog

### 1. `scoreGolfRelativeToParEntry`

Use for:

- golf relative-to-par contests in phase 1

Reads:

- `scoreToPar`
- `strokes`
- `madeCut`
- `withdrew`
- `position`

Rule config shape:

```ts
interface GolfRelativeToParFunctionConfig {
  countingMethod: 'ALL' | 'BEST_N';
  bestN?: number;
  missedCutPolicy: 'USE_SCORE' | 'PENALTY_SCORE' | 'EXCLUDE';
  missedCutPenaltyScore?: number;
  lowerIsBetter: true;
}
```

Participant data shape example:

```ts
interface GolfRelativeToParParticipantData {
  scoreToPar?: number;
  strokes?: number;
  madeCut?: boolean;
  withdrew?: boolean;
  position?: number;
  roundScores?: number[];
}
```

### 2. `scoreTeamWinPointsEntry`

Use for:

- team wins earning a fixed number of points

Reads:

- `wins`

Rule config shape:

```ts
interface TeamWinPointsFunctionConfig {
  pointsPerWin: number;
}
```

Participant data shape example:

```ts
interface TeamWinPointsParticipantData {
  wins?: number;
}
```

### 3. `scoreRoundMultiplierEntry`

Use for:

- team wins where later rounds are worth more

Reads:

- `wins`
- `roundReached`

Rule config shape:

```ts
interface RoundMultiplierFunctionConfig {
  basePointsPerWin: number;
  roundMultipliers: Record<string, number>;
}
```

Participant data shape example:

```ts
interface RoundMultiplierParticipantData {
  wins?: number;
  roundReached?: string;
}
```

### 4. `scoreSeedDifferentialBonusEntry`

Use for:

- team wins with a seed-differential upset bonus

Reads:

- `wins`
- `seed`
- `opponentSeed`

Rule config shape:

```ts
interface SeedDifferentialBonusFunctionConfig {
  bonusPerSeedDifference: number;
  underdogOnly?: boolean;
}
```

Participant data shape example:

```ts
interface SeedDifferentialBonusParticipantData {
  wins?: number;
  seed?: number;
  opponentSeed?: number;
}
```

### 5. `scoreFinishPositionEntry`

Use for:

- horse racing
- F1 / NASCAR position-driven pools
- any finish-position point table

Reads:

- `position`
- `dnf`
- optionally supporting stats like `lapsLed`, `fastestLap`

Rule config shape:

```ts
interface FinishPositionFunctionConfig {
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

### 6. `scorePlayerStatPointsEntry`

Use for:

- NFL fantasy
- NBA fantasy
- soccer fantasy
- tennis stat-based variants

Reads:

- normalized stat totals

Rule config shape:

```ts
interface PlayerStatPointsFunctionConfig {
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

### 7. `scorePredictionEntry`

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

This section proposes a small set of participant data shapes that scoring
functions can consume after reading `normalizedData` from
`SportEventParticipantSourceData`.

### Minimal common shell

```ts
interface CommonParticipantResult {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'WITHDRAWN' | 'ELIMINATED';
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

### Team win / round / seed bonus

```ts
interface TeamContestParticipantResult extends CommonParticipantResult {
  wins?: number;
  losses?: number;
  seriesWins?: number;
  roundReached?: string;
  seed?: number;
  opponentSeed?: number;
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

## Entry Aggregation Rules

Entry aggregation rules compute `ContestEntry.totalScore` from
`ContestEntryParticipantScore`.

### Initial EntryAggregationFunctionRegistry

- `SUM_ALL_ENTRIES`
- `SUM_TOP_N_ENTRIES`

### `SUM_ALL_ENTRIES`

Use for:

- contests where every selected participant contributes to the entry total

Example sketch:

```ts
function aggregateSumAllEntries(
  participantScores: ContestEntryParticipantScore[],
): number {
  return participantScores.reduce((sum, score) => sum + score.pointsEarned, 0);
}
```

### `SUM_TOP_N_ENTRIES`

Use for:

- golf contests like pick 6, use best 4

Example sketch:

```ts
function aggregateSumTopNEntries(
  participantScores: ContestEntryParticipantScore[],
  config: { topN: number; lowerIsBetter?: boolean },
): number {
  const sorted = [...participantScores].sort((a, b) =>
    config.lowerIsBetter ? a.pointsEarned - b.pointsEarned : b.pointsEarned - a.pointsEarned,
  );

  return sorted.slice(0, config.topN).reduce((sum, score) => sum + score.pointsEarned, 0);
}
```

## Launch Support Recommendation

Recommended first-pass participant scoring rules:

- `GOLF_RELATIVE_TO_PAR_TOTAL`
- `TEAM_WIN_POINTS`
- `ROUND_MULTIPLIER`
- `SEED_DIFFERENTIAL_BONUS`

These rules are defined concretely in the TypeScript reference sketches above
and are the only participant scoring rules needed to prove the architecture in
this plan.

Deferred:

- `PREDICTION`
- full bracket scoring
- survivor / pick'em-specific scoring
- most player-stat fantasy scoring
- `FINISH_POSITION_POINTS` unless a launch contest needs it

Recommended first-pass entry aggregation rules:

- `SUM_ALL_ENTRIES`
- `SUM_TOP_N_ENTRIES`

Only these two aggregation rules are in scope for Plan 51.

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
   - `ParticipantContestScoringRule`
   - `ContestEntryAggregationRule`
6. Subscriber updates:
   - `ContestEntryParticipantScore`
   - `ContestEntryParticipantScoreEvent`
   - `ContestEntry.totalScore`
   - `ContestEntry.standingsPosition`
   - `ContestEntry.isEliminated`
7. Prize logic may award `ContestEntryPrizeAward` if relevant

## Recommendations Outside Scoring Logic

- add `SportEventParticipant`
- add `SportEventParticipantSourceData`
- keep heterogeneous normalized JSON on source data
- keep first-class participant result fields to a minimum until implementation proves more commonality
- remove contest-local participant pool assumptions from scoring
- remove `ScoreStore` as source of truth
- persist participant-level score totals and score events
- write canonical score state directly to `ContestEntry`
- use current participant state for corrections and rescoring

## Locked Decisions

The following is now settled for Plan 51:

- `SportEventParticipant` should keep first-class fields to a minimum
- `SportEventParticipantSourceData` should store both:
  - `rawPayload`
  - `normalizedData`
- `RosterPick` references `sportEventParticipantId`
- `ContestConfiguration` owns:
  - `ParticipantContestScoringRule[]`
  - one active `ContestEntryAggregationRule`
- `ParticipantContestScoringRule` is the contest-owned configured participant scoring rule
- `ParticipantScoringDefinitionRegistry` is code-owned
- `ContestEntryAggregationRule` is the correct aggregation object name
- `EntryAggregationFunctionRegistry` is code-owned
- first pass supports exactly one active `ContestEntryAggregationRule` per contest
- participant scoring writes:
  - `ContestEntryParticipantScore`
  - `ContestEntryParticipantScoreEvent`
- `ContestEntryParticipantScoreEvent` stores delta points, not cumulative points
- participant score events reference `participantContestScoringRuleId`
- `ContestEntry.totalScore` remains persisted
- `ContestEntry.standingsPosition` remains persisted
- launch participant scoring rules are:
  - `GOLF_RELATIVE_TO_PAR_TOTAL`
  - `TEAM_WIN_POINTS`
  - `ROUND_MULTIPLIER`
  - `SEED_DIFFERENTIAL_BONUS`
- launch aggregation rules are:
  - `SUM_ALL_ENTRIES`
  - `SUM_TOP_N_ENTRIES`
- `PREDICTION` remains deferred
- golf phase 1 is relative-to-par only and explicitly excludes fantasy/per-hole scoring
- team playoff normalized data is sufficient for first pass with:
  - `wins`
  - `losses`
  - `seriesWins`
  - `roundReached`
  - `advanced`
- prize rule types remain code-owned through `PrizeDefinitionRegistry`
- `ContestPrizeDefinition` stores `prizeDefinitionId`
- `ContestEntryPrizeAward` points to `contestPrizeDefinitionId`
- `ContestPrizeDefinition.ruleConfig` stays JSON
- payout basics on `ContestPrizeDefinition` use explicit fields
- awards snapshot resolved display fields
- one entry can win multiple awards
- one prize definition can award multiple entries
- awards can be granted before contest completion
- awards must be recalculable/revocable after corrections
- contest-level total prize pool is optional

## Remaining Open Considerations

These are intentionally left open for implementation planning rather than being
blocked in the domain-model review:

- whether scoring recompute should be full rebuild or incremental per provider update
- which participant result fields, if any, deserve promotion out of `normalizedData` after real provider payload review
- whether additional participant scoring rules should be promoted from the deferred catalog in Plan 52

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 51-001 | 1 | Capture non-negotiable contest/scoring alignment changes | Done | Assumed throughout this plan |
| 51-002 | 1 | Replace declarative-first scoring direction with shared interface + explicit scoring functions | Done | Option B selected |
| 51-003 | 1 | Define target event-participant and source-data model for scoring inputs | Done | Minimal first-class participant shell and dual JSON payloads locked |
| 51-004 | 1 | Confirm participant scoring rule catalog and launch scope | Done | Four launch rules locked |
| 51-005 | 2 | Redesign `ContestConfiguration` scoring shape around contest-owned scoring rules and entry aggregation rules | Done | Participant rules plus one active aggregation rule locked |
| 51-006 | 2 | Replace score-store assumptions with participant score totals, score events, and entry aggregation | Done | `ContestEntryParticipantScore` and event ledger locked |
| 51-007 | 3 | Defer bracket / pick'em scoring to a later focused design pass unless promoted | Done | Deferred |
| 51-008 | 4 | Implement initial scoring-core registries and launch-rule unit tests under new module names | In Progress | `contest-scoring` module started with participant scoring definitions, aggregation functions, orchestrator, and unit coverage |

## Acceptance Criteria

- scoring direction is based on a shared interface plus explicit scoring functions
- participant selection references event-scoped participants
- heterogeneous event data is handled through `SportEventParticipantSourceData`
- launch participant scoring rules are identified
- launch entry aggregation rules are identified
- deferred scoring rules are explicitly called out
