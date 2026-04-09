# Plan 52: Potential Rules Function Expansion

## Purpose

Capture additional participant scoring rules and entry aggregation rules that
may be valuable after Plan 51 proves out the scoring architecture.

This plan is intentionally a later-review catalog. It should not expand the
first-pass launch scope established in
[plans/51-scoring-and-participant-data-review.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/51-scoring-and-participant-data-review.md).

Plan 51 launch scope remains:

- participant scoring rules:
  - `GOLF_RELATIVE_TO_PAR_TOTAL`
  - `TEAM_WIN_POINTS`
  - `ROUND_MULTIPLIER`
  - `SEED_DIFFERENTIAL_BONUS`
- entry aggregation rules:
  - `SUM_ALL_ENTRIES`
  - `SUM_TOP_N_ENTRIES`

## Principles

- new rule functions should fit the same registry/config pattern as Plan 51
- participant scoring rules belong in `ParticipantScoringDefinitionRegistry`
- contest-owned rule configuration belongs in `ParticipantContestScoringRule`
- entry aggregation rules belong in `EntryAggregationFunctionRegistry`
- contest-owned aggregation configuration belongs in `ContestEntryAggregationRule`
- new rules should be added only when they support a concrete sport/contest type

## Potential Participant Scoring Rules

### `MISSED_CUT_PENALTY`

Use for:

- golf contests where players missing the cut receive a configurable penalty

Best understanding of implementation:

- read `madeCut`, `roundsCompleted`, and/or `roundsMissed` from normalized golf
  participant data
- apply a fixed penalty per missed round or a flat penalty
- emit one participant score event row for the penalty

Example sketch:

```ts
interface MissedCutPenaltyRuleConfig {
  penaltyPerMissedRound?: number;
  flatPenalty?: number;
}
```

### `FINISH_POSITION_POINTS`

Use for:

- horse racing
- F1 / NASCAR
- any contest where finish place maps directly to points

Best understanding of implementation:

- read `position`
- look up points from a configured position table
- emit a score event with the resolved point value

Example sketch:

```ts
interface FinishPositionPointsRuleConfig {
  positionPoints: Record<number, number>;
  dnfPolicy?: 'ZERO' | 'LAST_PLACE' | 'PENALTY';
}
```

### `ROUND_REACHED_POINTS`

Use for:

- tennis tournament pools
- playoff team pools where advancement milestone matters more than individual wins

Best understanding of implementation:

- read `roundReached`
- map that round to configured point values
- emit one score event for the current reached round

Example sketch:

```ts
interface RoundReachedPointsRuleConfig {
  roundReachedPoints: Record<string, number>;
}
```

### `PLAYER_STAT_POINTS`

Use for:

- NFL fantasy
- NBA fantasy
- soccer fantasy
- stat-driven tennis or other player-stat contests

Best understanding of implementation:

- read a `stats` object from normalized participant data
- apply configured stat weights
- optionally emit one event per weighted stat or one combined event with detail

Example sketch:

```ts
interface PlayerStatPointsRuleConfig {
  statWeights: Record<string, number>;
}
```

### `THRESHOLD_BONUS`

Use for:

- fantasy thresholds such as:
  - 300+ passing yards
  - 100+ rushing yards
  - 100+ receiving yards
  - double-double
  - triple-double

Best understanding of implementation:

- inspect one configured stat
- apply points when threshold/operator matches
- emit a bonus score event

Example sketch:

```ts
interface ThresholdBonusRuleConfig {
  stat: string;
  operator: 'gte' | 'gt' | 'eq';
  value: number;
  points: number;
}
```

### `POSITION_BONUS_POINTS`

Use for:

- golf or other contests where tournament finish grants bonus points in addition
  to the main scoring rule

Best understanding of implementation:

- read final or current `position`
- apply configured bonus table
- emit a bonus score event

Example sketch:

```ts
interface PositionBonusPointsRuleConfig {
  bonusByPosition: Record<number, number>;
}
```

## More Specialized Participant Scoring Rules

These are valid ideas from the contest-rules document, but they appear more
specialized and should stay deferred until a launch sport needs them.

### `POSITION_CHANGE_POINTS`

Use for:

- F1 / NASCAR place differential scoring

Best understanding of implementation:

- compare `startingPosition` to `position`
- award or deduct points based on configured buckets or per-position delta

### `LAPS_LED_POINTS`

Use for:

- F1 / NASCAR

Best understanding of implementation:

- read `lapsLed`
- apply configured points per lap led

### `FASTEST_LAP_POINTS`

Use for:

- F1 / NASCAR

Best understanding of implementation:

- read `fastestLap` or `fastestLaps`
- emit fixed or per-occurrence bonus

### `STAGE_WIN_POINTS`

Use for:

- NASCAR

Best understanding of implementation:

- read `stageWins`
- apply configured points per stage win

### `BEAT_TEAMMATE_BONUS`

Use for:

- F1

Best understanding of implementation:

- compare `position` or finish status to teammate result
- emit fixed bonus when the participant beats their teammate

### `MATCH_STAT_POINTS`

Use for:

- tennis DFS-style scoring

Best understanding of implementation:

- read stats such as:
  - aces
  - double faults
  - break points won
- apply configured stat weights

### `STRAIGHT_SETS_WIN_BONUS`

Use for:

- tennis

Best understanding of implementation:

- inspect normalized match result
- emit bonus when the player wins without dropping a set

### `CONSECUTIVE_EVENT_BONUS`

Use for:

- golf streak bonuses like 3+ consecutive birdies

Best understanding of implementation:

- read round- or hole-level event sequence data
- emit bonus when the streak threshold is met

### `BOGEY_FREE_ROUND_BONUS`

Use for:

- golf

Best understanding of implementation:

- inspect round-level event detail
- emit bonus when no bogey-or-worse events occur

### `ROUND_SCORE_THRESHOLD_BONUS`

Use for:

- golf rounds such as `-5 or better`

Best understanding of implementation:

- inspect round score values
- emit bonus when configured threshold is achieved

## Prediction-Oriented Rules

These stay deferred until bracket / pick'em / survivor receives its own focused
design pass.

### `POINTS_PER_CORRECT_PREDICTION`

Best understanding of implementation:

- compare submitted predictions to actual outcomes
- award configured points for each correct prediction

### `UPSET_BONUS`

Best understanding of implementation:

- when a predicted lower seed beats a higher seed correctly, add seed-difference
  or configured bonus points

### `SEED_MULTIPLIER`

Best understanding of implementation:

- multiply correct prediction points by seed value

### `CONFIDENCE_WEIGHT_MULTIPLIER`

Best understanding of implementation:

- scale correct prediction points by user-assigned confidence rank/weight

### `CORRECT_SERIES_LENGTH_BONUS`

Best understanding of implementation:

- bonus for correctly predicting series length

### `CORRECT_SCORE_BONUS`

Best understanding of implementation:

- bonus for correctly predicting a final score or total

## Potential Entry Aggregation Rule Expansion

### `SUM_BOTTOM_N_ENTRIES`

Use for:

- contests where worst performers count, though this seems unlikely for early
  PoolMaster needs

Best understanding of implementation:

- sort participant score totals
- sum the lowest `N`

### `SUM_TOP_N_BY_TIER`

Use for:

- contests where picks are grouped by tiers and the best within each bucket
  count

Best understanding of implementation:

- require tier metadata on roster picks or a tier mapping
- group participant totals by tier
- apply top-N selection inside each tier

### `SUM_WITH_DROPS`

Use for:

- contests where a fixed number of worst scores are dropped

Best understanding of implementation:

- sort participant totals
- drop the worst `N`
- sum the remainder

## Review Notes

- `SUM_TOP_N_ENTRIES` already captures the most important early aggregation
  variation from the contest-rules document
- many rules in the contest-rules document are additive bonus rules that fit
  naturally as participant scoring rules
- the launch architecture should not add these until a concrete contest type
  needs them

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 52-001 | 1 | Catalog deferred participant scoring rules from contest-rules doc | Done | Captured in this plan |
| 52-002 | 1 | Catalog deferred entry aggregation rule ideas | Done | Captured in this plan |
| 52-003 | 2 | Promote approved later rules into implementation plans as sport coverage expands | Pending | Depends on later product decisions |
