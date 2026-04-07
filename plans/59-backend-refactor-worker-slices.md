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
| 59-004 | 2 | Implement Slice C: Compliance Removal Except Consent | Not Started | |
| 59-005 | 2 | Implement Slice D: Identity, League, Membership, and Squad rebuild | Not Started | |
| 59-006 | 3 | Implement Slice E: Contest core rebuild | Not Started | |
| 59-007 | 3 | Implement Slice F: Event participant and source-data rebuild | Not Started | |
| 59-008 | 4 | Implement Slice G: Scoring, aggregation, and prize rebuild | Not Started | |
| 59-009 | 4 | Implement Slice H: Commissioner contest-management APIs | Not Started | |
