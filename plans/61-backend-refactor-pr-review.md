# Plan 61: Backend Refactor PR Review

## Purpose

Provide a concise PR-style review summary for the backend refactor on
`codex-backend-refactor-lane`.

This is a review artifact for human review and cleanup, not an execution plan.

## Branch

- branch: `codex-backend-refactor-lane`
- latest reviewed commit at time of writing: `8198fd8`

## Summary

This refactor replaces the old contest/pool/template/result-centric backend with
the reviewed league-first, squad-owned, event-participant-based model.

The branch now reflects the new domain model through:

- schema and migrations
- Prisma persistence
- shared domain types
- DTOs and OpenAPI
- backend route contracts
- scoring and prize application
- history and standings reads
- unit and DB integration tests

## Major Change Areas

### 1. Ownership And Core Entities

- `ContestEntry` now belongs to `Squad`, not `LeagueMembership`
- `Squad` and `SquadMembership` are implemented
- `ContestEntry` now carries:
  - `entryNumber`
  - `status`
  - `standingsPosition`
  - persisted `totalScore`
- `RosterPick` is event-scoped through `sportEventParticipantId`

### 2. Contest Configuration

- `Contest` is linked to `SportEvent`
- `ContestConfiguration` is the commissioner-owned setup object
- configuration now owns:
  - participant scoring rules
  - entry aggregation rule
  - prize definitions
  - roster/entry limits and lock behavior
- old contest-level scoring-rule and payout blob behavior is removed from the
  active backend surface

### 3. Event Participant Model

- `SportEventParticipant` is the event-scoped participant identity
- `SportEventParticipantSourceData` stores:
  - `rawPayload`
  - `normalizedData`
- `SportEventParticipantValuation` supports draft/budget/tier selection flows
- ingestion persists the new event-participant model directly

### 4. Scoring And Prizes

- scoring now runs through configured participant scoring rules and an entry
  aggregation rule
- persisted scoring results now live in:
  - `ContestEntryParticipantScore`
  - `ContestEntryParticipantScoreEvent`
- prize outcomes now live in:
  - `ContestEntryPrizeAward`
- launch scoring implementations are in place for:
  - `GOLF_RELATIVE_TO_PAR_TOTAL`
  - `TEAM_WIN_POINTS`
  - `ROUND_MULTIPLIER`
  - `SEED_DIFFERENTIAL_BONUS`
- launch aggregation implementations are in place for:
  - `SUM_ALL_ENTRIES`
  - `SUM_TOP_N_ENTRIES`
- commissioner recalculation updates:
  - participant score events
  - participant score totals
  - entry totals
  - standings positions
  - final-place prize awards

### 5. History And Standings

- live standings no longer depend on `ContestStanding`
- completed-contest history no longer depends on `ContestResult` snapshots
- first-pass history reads now derive from active core entities

### 6. Scope Reduction

Removed or deferred from the active backend:

- search/discovery
- contest templates
- billing
- most compliance/account-rights surfaces
- public discovery concepts
- prediction-only contest runtime paths
- old scoring template stack
- out-of-scope site-admin features

## Test And Contract Review

Broad final validation completed:

- `npx jest --config tests/jest.config.js --forceExit`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster_test npx jest --config tests/integration/jest.config.js --forceExit`
- focused eslint and typecheck passes
- OpenAPI export/validate/generate passes

Two stale-test issues surfaced during the final broad run:

- a removed scoring-template registry import in a deferred test file
- an outdated contest-management expectation

Both were corrected, and the full backend suites now pass.

## Review Findings

No blocking findings remain for the agreed backend-first refactor scope.

The only non-blocking residuals are:

- intentionally deferred enum/catalog values that remain documented as deferred
- benign helper or operation-id names that do not represent active legacy model
  dependencies

## Suggested Reviewer Focus

If reviewing the branch manually, prioritize:

1. squad ownership and contest-entry realignment
2. `ContestConfiguration` structure
3. event-participant persistence and ingestion flow
4. scoring-rule, aggregation-rule, and prize-definition persistence
5. recalculation pipeline and persisted scoring results
6. history and standings reads against the new model
7. removal of old template/discovery/billing/compliance/prediction surfaces

## Suggested Companion Files For Review

- [37-league-top-level-domain-and-data-simplification.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md)
- [38-contest-entry-and-squad-alignment-review.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review.md)
- [38-contest-entry-and-squad-alignment-review-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review-user-cases.md)
- [39-sport-event-import-and-status-propagation-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/39-sport-event-import-and-status-propagation-user-cases.md)
- [41-contest-history-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/41-contest-history-user-cases.md)
- [42-history-simplification.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/42-history-simplification.md)
- [51-scoring-and-participant-data-review.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/51-scoring-and-participant-data-review.md)
- [53-commissioner-tools-contest-management-use-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/53-commissioner-tools-contest-management-use-cases.md)
- [59-backend-refactor-worker-slices.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/59-backend-refactor-worker-slices.md)
