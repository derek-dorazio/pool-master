# Plan 56: Search And Discovery Removal

## Purpose

Remove the current search/discovery implementation that is misaligned with the
league-first, invite-only, no-contest-pool first-pass product direction.

This plan does **not** replace search/discovery with a new subsystem.

Instead, it makes clear that:

- public discovery is out of scope
- contest browsing is a normal league product flow, not a discovery feature
- the existing discovery tables, routes, and supporting code should not be
  preserved by default

## Product Direction

For launch, the product only needs:

- an active contests view
- the ability to create entries for an active contest
- the ability to view entries for an active contest
- hiding other users' entry details until the contest is `LOCKED`
- a completed contest history view

Those are covered by:

- [plans/38-contest-entry-and-squad-alignment-review-user-cases.md](./38-contest-entry-and-squad-alignment-review-user-cases.md)
- [plans/41-contest-history-user-cases.md](./41-contest-history-user-cases.md)
- [plans/53-commissioner-tools-contest-management-use-cases.md](./53-commissioner-tools-contest-management-use-cases.md)

## What Should Be Removed

### Schema / Model

- `DiscoverableLeague`
- `DiscoverableContest`
- `DiscoveryReport`

### Service / API

- search/discovery endpoints and supporting service code that exist only to
  power public discovery
- commissioner pool-setup search assumptions tied to contest-pool configuration

### Product Assumptions To Drop

- open/public contest discovery
- public league discovery
- discovery moderation/report flows
- contest-pool search as a first-pass commissioner responsibility

## Important Clarification

Removing search/discovery does **not** mean the product lacks:

- contest browsing
- contest entry creation
- contest entry list viewing
- contest history browsing

Those are regular contest and history features, not discovery features.

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 56-001 | 1 | Remove discovery models from the target schema and migration plan | Done | Removed `DiscoverableLeague`, `DiscoverableContest`, and `DiscoveryReport` from Prisma target schema and baseline migration |
| 56-002 | 1 | Remove discovery routes/services that exist only for public discovery behavior | Done | Removed `/api/v1/search`, search/discovery service code, DTOs, mappers, and app wiring |
| 56-003 | 2 | Remove or rewrite tests that enforce the old discovery subsystem | Done | Removed search/discovery harness wiring and refreshed active backend contract outputs |
| 56-004 | 2 | Ensure contest browsing/history flows remain covered through the normal contest use-case docs | Done | Covered in Plans 38 and 41 |
