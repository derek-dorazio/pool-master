# Plan 59: Backend Refactor Worker Slices

## Purpose

Break the backend-first refactor into worker-friendly execution slices that can
be implemented, validated, and merged independently on
`codex-backend-refactor-lane`.

This plan does not redefine the target model. It organizes implementation work
already defined by the active simplification and use-case plans.

## Slice Strategy

Principles:

- each slice should be coherent and independently testable
- each slice should use the new domain names directly
- slices should remove legacy concepts outright instead of preserving
  compatibility layers
- early slices should target high-confidence removals that prove the workflow
  before the schema reset and deeper model rebuild begin

## Recommended Slice Order

### Slice A: Remove Search And Discovery

Scope:

- remove public discovery schema/models
- remove `/api/v1/search` backend module
- remove search/discovery DTOs, mappers, and generated contract surface
- keep ordinary participant listing/search under participants module untouched

Primary plan:

- [Plan 56](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/56-search-and-discovery-removal.md)

### Slice B: Remove Contest Templates

Scope:

- remove `ContestTemplate` schema/model
- remove `/api/v1/templates`
- remove template service/handler/repository/DTO/mappers
- remove template-related generated contract surface

Primary plan:

- [Plan 54](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/54-contest-template-removal.md)

### Slice C: Remove Compliance Except Consent

Scope:

- remove deletion/export/self-exclusion/enforcement/retention slices
- keep only `ConsentRecord` and minimal consent/age-affirmation behavior

Primary plans:

- [Plan 55](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/55-privacy-and-account-compliance-removal.md)
- [Plan 57](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/57-privacy-and-account-compliance-deferred.md)
- [Plan 58](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/58-consent-and-age-affirmation-user-cases.md)

### Slice D: Reset Top-Level Identity And League Model

Scope:

- remove `Tenant`
- rebuild `User`, `League`, `LeagueMembership`, `Squad`, and invitation model
- align authorization to league-first roles

Primary plans:

- [Plan 36](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/36-authentication-and-authorization-unification.md)
- [Plan 37](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/37-league-top-level-domain-and-data-simplification.md)

### Slice E: Rebuild Contest Core

Scope:

- rebuild `Contest`, `ContestConfiguration`, `ContestEntry`, `RosterPick`
- remove retired contest pool/result/history artifacts

Primary plans:

- [Plan 38](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/38-contest-entry-and-squad-alignment-review.md)
- [Plan 41](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/41-contest-history-user-cases.md)
- [Plan 42](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/42-history-simplification.md)
- [Plan 53](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/53-commissioner-tools-contest-management-use-cases.md)

### Slice F: Rebuild Event Participant And Source Data

Scope:

- add `SportEventParticipant`
- add `SportEventParticipantSourceData`
- align contest picks to event-scoped participant identity

Primary plans:

- [Plan 39](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/39-sport-event-import-and-status-propagation-user-cases.md)
- [Plan 51](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/51-scoring-and-participant-data-review.md)

### Slice G: Rebuild Scoring, Aggregation, And Prizes

Scope:

- add `ParticipantContestScoringRule`
- add `ContestEntryAggregationRule`
- add participant score totals and events
- add `ContestPrizeDefinition` and `ContestEntryPrizeAward`

Primary plans:

- [Plan 51](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/51-scoring-and-participant-data-review.md)
- [Plan 52](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/52-potential-rules-function-expansion.md)

### Slice H: Rebuild Commissioner Contest Operations

Scope:

- commissioner contest-management APIs
- contest readiness/configuration operations
- league-first authorization behavior

Primary plans:

- [Plan 44](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/44-league-first-commissioner-administration-user-cases.md)
- [Plan 45](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/45-league-first-administration-migration.md)
- [Plan 53](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/53-commissioner-tools-contest-management-use-cases.md)

### Slice I: Remove Out-Of-Scope Site Admin Features

Scope:

- remove feature flags admin surfaces
- remove platform announcement admin surfaces
- remove support investigation and quick-actions admin surfaces
- keep migrations, health, provider operations, platform config, and audit

Primary plans:

- [Plan 45](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/45-league-first-administration-migration.md)
- [Plan 46](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/46-site-administration-user-cases.md)

## Worker Guidance

Each worker slice should own a disjoint write set whenever possible.

Recommended first worker assignments:

- Worker 1:
  - Slice A: Search And Discovery Removal
- Worker 2:
  - Slice B: Contest Template Removal

These are good bootstrap slices because they:

- are already explicitly out of scope
- have minimal dependency on the new schema buildout
- prove the worker process, testing strategy, and CI lane before deeper model
  changes

## Definition Of Done Per Slice

Every slice should satisfy the backend-refactor rules:

- schema and migration changes included when applicable
- ORM/entity mapping updated
- DTOs and route schemas updated
- OpenAPI refreshed and validated when contract surface changes
- backend unit tests updated
- DB integration tests updated when persistence is involved
- plan task rows updated with final status and notes

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 59-001 | 1 | Create the worker-slice execution plan for the backend refactor lane | Done | Slice plan created and staged for worker execution |
| 59-002 | 1 | Implement bootstrap Slice A: Search And Discovery Removal | Done | Public discovery schema, routes, DTOs, mappers, and app wiring removed |
| 59-003 | 1 | Implement bootstrap Slice B: Contest Template Removal | Done | Contest template model, routes, handlers, repository, tests, schema, and migration cleanup completed |
| 59-004 | 2 | Implement Slice C: Compliance Removal Except Consent | Done | Compliance subsystem removed, retention routes/config removed, and minimal account-consent module plus consent tests added |
| 59-005 | 2 | Implement Slice D: Identity, League, Membership, and Squad rebuild | In Progress | Added `Squad` / `SquadMembership` schema, repositories, league-scoped squad management APIs, and focused unit + DB integration coverage as the first target-shaped ownership step before migrating contest entries off league membership |
| 59-006 | 3 | Implement Slice E: Contest core rebuild | In Progress | `ContestEntry` now uses `squadId`, `entryNumber`, `status`, and `standingsPosition`; `RosterPick` now references `sportEventParticipantId`; roster draft/pick flows resolve display state through `SportEventParticipant`; draft-room selectable participants now come from `SportEventParticipant` plus the latest `SportEventParticipantValuation` instead of retired contest-pool rows; live standings reads plus commissioner recalculation now derive from `ContestEntry` instead of `ContestStanding`; periodic standings rollup and admin standings recalculation no longer write legacy `ContestStanding`, and the old `contest_standings` schema has now been removed; first-pass history routes are trimmed to completed-contest summary, standings, payouts, roster detail, league results, and member results, all derived from `ContestEntry`, `RosterPick`, `ContestEntryPrizeAward`, and `SportEventParticipantSourceData`, with the legacy `contest_results`, `payout_history`, and `team_roster_history` tables removed; deferred history analytics/import/export/replay services have been deleted; `scoring_checkpoints`, `league_records`, `rivalry_records`, `league_season_summaries`, `trophies`, and `season_notes` are now also removed from the active schema; weekly digest and digest-config surfaces have been removed from notifications/admin wiring; the dead internal contest-pool repositories/services/schema have now been removed along with their old unit coverage; the retired public contest-pool API surface has been removed from app/test registration so the generated contract no longer exposes those out-of-scope endpoints; `DraftSession.pickDeadline` is now `currentTurnStartedAt`; `DraftPick` has been renamed to `DraftPickHistory` and now references `rosterPickId`; live draft-room responses now expose `draftPickHistories` instead of `picks`; active draft-room configuration now reads from `ContestConfiguration` instead of `SelectionConfig`, the old `selection_configs` table is dropped, the old draft/admin selection-template endpoints and services are removed, and the deferred `contest_matchups`, `contest_picks`, `bracket_predictions`, `OPEN_SELECTION`, pick’em, bracket, and survivor runtime paths have now been removed so the active backend only supports the roster-based first-pass selection modes; the active contest CRUD contract no longer accepts legacy `seasonId`, contest-level `scoringRules`, or contest-level `payoutConfig`, the old payout-confirmation override route is removed, the shared `Contest` domain model no longer exposes season-scoped or contest-level scoring-rule state, the legacy `season_id`, `scoring_rules`, `payout_config`, `is_imported`, `imported_by`, `start_date`, and `end_date` columns are now dropped from the `contests` table, and `contest.sport` is no longer persisted directly because admin/history/read paths now derive it from the linked `SportEvent` |
| 59-007 | 3 | Implement Slice F: Event participant and source-data rebuild | In Progress | `SportEventParticipant`, provider source-data, and valuation persistence are in place, ingestion now upserts event participants and source data from event detail payloads, and both roster selection/scoring lookups and commissioner/member draft-room reads now resolve through event-scoped participants plus current valuations |
| 59-008 | 4 | Implement Slice G: Scoring, aggregation, and prize rebuild | In Progress | Main thread added `contest-scoring` registries and launch-rule unit tests, persisted contest configuration / prize-definition tables, and now has `ContestEntryParticipantScore`, score-event, and prize-award persistence plus a real entry result replacement service; commissioner `/api/v1/contests/:contestId/scoring/recalculate` now executes the new-model scoring, ranking, and `FINAL_PLACE` prize-application path; scoring leaderboard/detail/history routes and manual rollup now read persisted `ContestEntry` / score-event state instead of `ScoreStore`; the stat-event consumer now treats incoming stat events as contest recalculation triggers that publish `score.updated` from real entry changes instead of mutating in-memory score state; and the dead `ScoreStore` plus unused `ContestStandingRepository` adapter/port exports have been removed, with focused unit + DB integration coverage |
| 59-009 | 4 | Implement Slice H: Commissioner contest-management APIs | In Progress | Added dedicated league-scoped contest-management create/get/update APIs with real Prisma repositories, route schemas, and DB-backed integration coverage |
| 59-010 | 2 | Implement Slice I: Remove out-of-scope site admin features | Done | Feature flag, global announcement, support investigation, and quick-action backend surfaces removed; platform health, provider operations, migrations, config, and audit preserved |
