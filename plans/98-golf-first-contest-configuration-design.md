## Purpose

Prepare a developer-ready golf-first contest configuration design that:

- supports a truthful first implementation for golf contests
- preserves a clean path for additional sports later
- narrows the current generic contest-management surface into approved
  contest-mode-specific configuration

This plan is a design and handoff companion for the next implementation lane.

## Dependencies

- [plans/88-contest-creation-and-configuration-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/88-contest-creation-and-configuration-user-cases.md)
- [plans/89-contest-entry-and-member-participation-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/89-contest-entry-and-member-participation-user-cases.md)
- [plans/90-contest-lifecycle-and-scoring-propagation-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/90-contest-lifecycle-and-scoring-propagation-user-cases.md)
- [plans/91-sport-data-ingestion-and-contest-update-user-cases.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/91-sport-data-ingestion-and-contest-update-user-cases.md)

## Scope

- golf only for the first implemented contest family
- single-event contests only
- commissioner configuration for two approved golf contest config types
- the fact-model and resolver responsibilities needed to populate the eligible
  golfer pools from imported event/participant data
- explicit future-sport guardrails for the implementation team

## Out Of Scope

- non-golf sports
- season-long contest modes
- fully generic contest-engine authoring UI
- prize configuration
- public contest/leaderboard browsing outside the league/member context

## Locked Product Direction

- first implemented sport is `GOLF`
- first implemented contest type is `SINGLE_EVENT`
- contest standings are displayed primarily as `TO_PAR`
- entries belong to Teams
- a commissioner can configure `maxEntriesPerTeam`
  - a positive integer, or
  - unlimited
- lock time is presented in the commissioner UI as an offset relative to event
  start
  - default is `5 minutes before start`
  - common preset is `1 hour before start`
  - custom hours/minutes before start is also allowed
  - PoolMaster still persists the derived absolute `lockAt` timestamp
- ties do not remain ties:
  - entries predict the winning score
  - closest predicted winning score wins the tiebreaker
- contest lifecycle is primarily automatic:
  - commissioners manage and delete drafts before the event begins
  - `LOCKED` follows the derived `lockAt`
  - in-progress / active follows event start and feed updates
  - `COMPLETED` follows final event status and final scoring sync
- unsupported sports should not appear in the commissioner contest-creation UI

## Approved Golf Contest Config Types

### 1. `GolfTieredContestConfig`

Purpose:
- commissioner creates a roster-style golf contest where each Team picks `X`
  golfers and the best `Y` scores count

Examples:
- pick 6, count best 4
- pick 8, count best 5

Allowed selection logic:
- one global tier source for the entire contest
- initial basic setup seeds tiers automatically
- advanced setup allows commissioner editing of the seeded tiers

Approved tier sources:
- `ODDS` (default)
- `WORLD_RANK`

Basic commissioner inputs:
- contest name
- tournament / sport event
- template selection
- lock timing relative to event start
- max entries per team

Normal-flow expectation:
- the default template should be preselected
- commissioners should usually accept a seeded template without editing the
  detailed fields below
- detailed tier inputs belong to advanced configuration

Advanced commissioner inputs:
- manual tier boundaries
- per-tier pick counts
- missed-cut fallback score

Default values:
- `rosterSize = 6`
- `countedScores = 4`
- `tierSource = ODDS`
- `defaultTierSize = 10`
- `pickCount = 1` for every tier
- missed-cut fallback score defaults to `80`

### 2. `GolfCategoryContestConfig`

Purpose:
- commissioner creates a category-slot contest where each Team picks one golfer
  from each enabled category

Approved starter category catalog:
- `SENIOR`
- `ROOKIE`
- `PREVIOUS_WINNER`
- `US_PLAYER`
- `INTERNATIONAL_PLAYER`

Basic commissioner inputs:
- contest name
- tournament / sport event
- template selection
- lock timing relative to event start
- max entries per team

Normal-flow expectation:
- the default template should be preselected
- commissioners should usually accept a seeded template without editing the
  detailed category fields below

Advanced commissioner inputs:
- missed-cut fallback score

Default values:
- one pick per enabled category
- missed-cut fallback score defaults to `80`

## Shared Golf Scoring Rules

These rules are shared by both approved golf config types:

- scoring display is `TO_PAR`
- playoff holes are excluded
- commissioner may edit the missed-cut fallback score in advanced setup
- default lock timing is `5 minutes before event start`
- tiebreaker is:
  - `winning-score prediction`
  - closest prediction wins

These rules should not be modeled as an untyped freeform blob. They should be
validated through an explicit golf scoring rules schema.

## Approved Typed JSON Shapes

### `GolfTieredContestConfig`

```json
{
  "mode": "GOLF_TIERED",
  "rosterSize": 6,
  "countedScores": 4,
  "tierSource": "ODDS",
  "tierGeneration": {
    "defaultTierSize": 10
  },
  "tiers": [
    {
      "tierKey": "A",
      "label": "Tier A",
      "pickCount": 1,
      "startPosition": 1,
      "endPosition": 10
    },
    {
      "tierKey": "B",
      "label": "Tier B",
      "pickCount": 1,
      "startPosition": 11,
      "endPosition": 20
    },
    {
      "tierKey": "C",
      "label": "Tier C",
      "pickCount": 1,
      "startPosition": 21,
      "endPosition": 30
    },
    {
      "tierKey": "D",
      "label": "Tier D",
      "pickCount": 1,
      "startPosition": 31,
      "endPosition": 40
    },
    {
      "tierKey": "E",
      "label": "Tier E",
      "pickCount": 1,
      "startPosition": 41,
      "endPosition": 50
    },
    {
      "tierKey": "F",
      "label": "Tier F",
      "pickCount": 1,
      "startPosition": 51,
      "endPosition": null
    }
  ],
  "cutRule": {
    "type": "FIXED_SCORE",
    "fixedScore": 80
  },
  "playoffHandling": "EXCLUDE_PLAYOFF_HOLES",
  "displayScoring": "TO_PAR",
  "tiebreaker": {
    "type": "PREDICT_WINNING_SCORE"
  }
}
```

### `GolfCategoryContestConfig`

```json
{
  "mode": "GOLF_CATEGORY_PICKS",
  "categories": [
    {
      "categoryKey": "SENIOR",
      "label": "Senior",
      "pickCount": 1
    },
    {
      "categoryKey": "ROOKIE",
      "label": "Rookie",
      "pickCount": 1
    },
    {
      "categoryKey": "PREVIOUS_WINNER",
      "label": "Previous Winner",
      "pickCount": 1
    },
    {
      "categoryKey": "US_PLAYER",
      "label": "US Player",
      "pickCount": 1
    },
    {
      "categoryKey": "INTERNATIONAL_PLAYER",
      "label": "International Player",
      "pickCount": 1
    }
  ],
  "cutRule": {
    "type": "FIXED_SCORE",
    "fixedScore": 80
  },
  "playoffHandling": "EXCLUDE_PLAYOFF_HOLES",
  "displayScoring": "TO_PAR",
  "tiebreaker": {
    "type": "PREDICT_WINNING_SCORE"
  }
}
```

## Delineation Between The Two Config Types

`GolfTieredContestConfig`
- Team builds a golfer roster
- commissioner defines pick `X`, count best `Y`
- one global tier source drives tier generation
- advanced mode edits tier boundaries and per-tier pick counts

`GolfCategoryContestConfig`
- Team fills one golfer slot for each enabled category
- no tier source exists
- no roster-size / counted-scores inputs exist
- category slots are driven by an approved category catalog

## Fact Model And Resolver Responsibilities

The contest config must not copy full participant lists into each contest.

Instead:

1. contest config stores commissioner-authored rules and parameters
2. sport-event / participant data stores imported facts
3. a resolver evaluates the contest config against the imported facts
4. the resolver persists a resolved contest-field snapshot used by entry UI and
   entry validation

### Imported Facts Required For Golf v1

The ingestion/event-participant layer must be able to provide:

- event field membership
- tournament outright odds order
- world-rank order
- rookie flag
- senior flag
- previous winner flag for the same tournament
- nationality / country
- round scores
- total strokes / total to par
- cut status
- playoff-hole exclusion semantics or raw data that allows exclusion

### Recommended Resolved Contest-Field Snapshot Layer

Implementation should add a resolved contest-field layer rather than evaluating
rules on every entry request.

Recommended records:

- `ContestSelectionGroup`
  - `contestId`
  - `groupKey`
  - `groupType`
  - `label`
  - `pickCount`
  - `sortOrder`
- `ContestSelectionGroupParticipant`
  - `contestSelectionGroupId`
  - `participantId`
  - `sportEventParticipantId`
  - resolved ordering / metadata fields as needed

Lifecycle rule:
- resolve and freeze the contest field when the contest is created
- do not let later odds/rank changes drift the entry-eligibility field after
  Teams have entered

## Module Responsibilities

### Ingestion / Event-Participant Module

Owns:
- imported event field facts
- rankings
- odds
- participant category facts
- scoring source data

### Contest Configuration Module

Owns:
- seeded contest templates plus commissioner-authored contest instance config
- typed contest config JSON
- commissioner-visible defaults and advanced overrides

### Contest Resolver Module

Owns:
- interpreting config rules against event/participant facts
- generating resolved contest selection groups
- freezing the resolved group snapshot before lock

### Entry Module

Owns:
- validating entry selections against the resolved snapshot
- enforcing max entries per team
- collecting the winning-score tiebreaker prediction

### Scoring / Standings Module

Owns:
- to-par scoring reads
- best-`Y`-of-`X` aggregation for tiered contests
- category-slot scoring aggregation for category contests
- winning-score prediction tiebreak resolution

## Developer Guardrails

- keep `Contest` generic, but keep active config typed per approved contest mode
- do not expose the existing generic contest-management config surface directly
  in the new commissioner UI
- do not use unconstrained freeform JSON for active contest config contracts
- use one validated config schema per contest mode
- do not persist full participant lists inside contest config JSON
- derive and freeze participant eligibility through a resolver snapshot layer
- treat unsupported sports and contest modes as unavailable, not half-visible
  placeholders
- keep prize configuration deferred until golf contest lifecycle and scoring are
  truly working

## Recommended First Implementation Order

1. narrow current contest-management DTO/domain surface to the approved
   golf-first shell
2. add typed config support for:
   - `GolfTieredContestConfig`
   - `GolfCategoryContestConfig`
3. add event/participant fact support required for rule resolution
4. build the resolver snapshot layer
5. build commissioner create/configure UI for golf tiered contests first
6. build Team entry flow and leaderboard for golf tiered contests
7. add `GolfCategoryContestConfig`

## Open Questions

- whether category contests should ship in the same release as tiered contests
  or immediately after the first golf tiered lifecycle is complete
- whether timing-default policy should be modeled as a persisted seeded table or
  a lighter seed-backed registry
- whether the frozen released-contest field needs an auxiliary audit/debug JSON
  snapshot in addition to normalized projection tables

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 98-001 | 1 | Product/design review of golf-first contest family | Done | Locked `GolfTieredContestConfig` and `GolfCategoryContestConfig` as the first approved golf contest configs. |
| 98-002 | 1 | Data-modeler review of contest config typing and resolver responsibilities | Done | Approved typed config per contest mode, event/participant fact ownership, and a frozen resolved-pool snapshot layer. |
| 98-003 | 1 | Developer handoff for commissioner config UX defaults vs advanced controls | Done | Basic vs advanced controls are explicitly defined for tiered and category golf contests, and current direction now assumes a template-first normal flow with advanced overrides as an optional path. |
| 98-004 | 2 | Backend/model narrowing plan for golf-first contest config | In Progress | Added typed golf contest config enums, DTOs, service narrowing, and persisted `configMode` / `configJson` fields; validating downstream integrations now. |
| 98-005 | 2 | Frontend execution plan for commissioner create/configure contest flow | Done | Added a shared commissioner create/manage contest page, league/app-shell/detail entry points, relative lock-time controls, draft-only delete/manage behavior, category picks, advanced controls, and edit-mode save wiring aligned to the golf-first typed contract. |
