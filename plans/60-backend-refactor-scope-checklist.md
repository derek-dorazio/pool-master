# Plan 60: Backend Refactor Scope Checklist

## Purpose

Provide a final review checklist that separates:

- implemented scope
- deferred-by-decision scope
- removed-by-decision scope

for the backend refactor on `codex-backend-refactor-lane`.

This is a review artifact, not a new implementation plan.

## Implemented

### Core Domain Model

- `League`, `LeagueMembership`, and league-first authorization remain active
- `Squad` and `SquadMembership` are implemented
- `ContestEntry` now belongs to `Squad`
- `ContestEntry` includes:
  - `entryNumber`
  - `status`
  - `standingsPosition`
  - persisted `totalScore`
- `RosterPick` now references `sportEventParticipantId`
- `DraftSession.currentTurnStartedAt` replaces the old pick-deadline clock concept
- `DraftPickHistory` replaces the old direct draft-pick history naming

### Contest And Configuration

- `Contest` now links to `sportEventId`
- active contest CRUD no longer uses:
  - `seasonId`
  - contest-level `scoringRules`
  - contest-level `payoutConfig`
  - top-level persisted `sport`
- `ContestConfiguration` is implemented as the owner of:
  - selection/roster configuration
  - participant scoring rules
  - entry aggregation rule
  - prize definitions
- commissioner contest-management APIs are implemented for:
  - create contest
  - read contest detail
  - update contest configuration

### Event And Participant Data

- `SportEventParticipant` is implemented
- `SportEventParticipantSourceData` is implemented
- `SportEventParticipantValuation` is implemented
- ingestion persists:
  - `SportEvent`
  - `Participant`
  - `SportEventParticipant`
  - raw provider payload JSON
  - normalized participant result JSON

### Scoring And Aggregation

- `ParticipantScoringDefinitionRegistry` is implemented in code
- `ParticipantContestScoringRule` persistence is implemented
- `EntryAggregationFunctionRegistry` is implemented in code
- `ContestEntryAggregationRule` persistence is implemented
- `ContestEntryParticipantScore` persistence is implemented
- `ContestEntryParticipantScoreEvent` persistence is implemented
- `ContestEntryScoringResultService` is implemented
- `ContestScoringRecalculationService` is implemented
- launch participant scoring definitions implemented:
  - `GOLF_RELATIVE_TO_PAR_TOTAL`
  - `TEAM_WIN_POINTS`
  - `ROUND_MULTIPLIER`
  - `SEED_DIFFERENTIAL_BONUS`
- launch aggregation rules implemented:
  - `SUM_ALL_ENTRIES`
  - `SUM_TOP_N_ENTRIES`
- commissioner recalculation endpoint is implemented
- stat-event consumer now triggers contest recalculation instead of mutating in-memory score state
- live scoring reads now come from:
  - `ContestEntry`
  - `ContestEntryParticipantScore`
  - `ContestEntryParticipantScoreEvent`

### Prizes

- `ContestPrizeDefinition` persistence is implemented
- `ContestEntryPrizeAward` persistence is implemented
- prize definitions are owned by `ContestConfiguration`
- prize awards are owned by `ContestEntry`
- launch prize application for `FINAL_PLACE` is implemented in the recalculation flow

### History And Read Models

- live standings read from `ContestEntry`
- first-pass history reads are implemented for:
  - contest summary
  - contest standings
  - contest payouts
  - roster history
  - league results
  - member results
- completed history reads derive from:
  - `Contest`
  - `ContestEntry`
  - `RosterPick`
  - `ContestEntryPrizeAward`
  - `SportEventParticipantSourceData`

### Consent

- retained minimal consent backend
- retained age-affirmation capture as part of consent flow

### Validation

- full backend unit suite passes
- full backend integration suite passes
- OpenAPI export/validate/generate passes
- generated shared client artifacts are synced to the current backend contract

## Deferred By Decision

These were intentionally left out of the active first-pass backend implementation.

### Contest Types / Selection Modes

- `OPEN_SELECTION`
- pick’em
- bracket prediction
- survivor
- broader prediction-specific scoring

### Scoring Expansion

- additional participant scoring rules listed in:
  - [52-potential-rules-function-expansion.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/52-potential-rules-function-expansion.md)
- broader prize-definition expansion beyond the current launch-support path
- provider-specific recompute-vs-delta strategy decisions pending deeper feed implementation review

### Privacy / Compliance

- data export request
- deletion request
- self-exclusion
- account enforcement
- retention config
- retention jobs
- broader privacy/compliance tooling

### Discovery / Search

- public contest discovery
- public league discovery
- public discovery moderation/reporting

### Broader Product Areas

- web rebuild against the new SDK
- admin rebuild against the new SDK
- future analytics/history features removed from the active backend

## Removed By Decision

These concepts were intentionally removed from the active backend model/runtime.

### Removed Domain / Schema Concepts

- `ContestTemplate`
- `ContestPool`
- `ContestParticipantPool`
- `SelectionConfig`
- `ContestPick`
- `ContestMatchup`
- legacy `BracketPrediction` runtime path
- `ContestStanding`
- `ContestResult`
- `PayoutHistory`
- `TeamRosterHistory`
- `ScoreStore`

### Removed Runtime Surfaces

- public search/discovery backend
- contest template backend
- billing backend surfaces
- out-of-scope site-admin features
- legacy scoring-template backend paths
- deferred prediction-mode runtime paths

### Removed / Simplified History Surfaces

- deferred analytics/history writer services
- weekly digest runtime/admin config surfaces
- removed schema tables:
  - `scoring_checkpoints`
  - `league_records`
  - `rivalry_records`
  - `league_season_summaries`
  - `trophies`
  - `season_notes`

## Review Conclusion

For the agreed backend refactor scope:

- the planned active model change is implemented
- the planned active use cases are implemented
- the backend test coverage for the implemented scope is passing

What remains is either:

- explicitly deferred for later phases
- or intentionally removed from the first-pass backend
