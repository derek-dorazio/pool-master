# Integration CRUD Rebuild

> **Planning Note (2026-04-03):** Re-analyze the current product scope, active MVP routes, and recent DTO/model changes before extending this plan. Do not restore deleted legacy suites verbatim.

## Purpose

Rebuild backend integration coverage from scratch using small, self-contained CRUD-style suites that:

- create their own data
- use shared enums/constants
- validate real route behavior
- clean up through real routes when practical
- avoid seed assumptions and cross-suite coupling

## Principles

- Prefer one domain flow per suite.
- Keep setup local to the suite.
- Use explicit created records instead of `findFirst()` on shared data.
- Strip `content-type` from bodyless POST/DELETE requests when required by the live route contract.
- Run DB-backed suites outside the sandbox/container when they require developer-local Postgres access.

## Batch Order

1. Contest CRUD
   - Status: Done
   - create league
   - create contest
   - list contest
   - fetch contest
   - update contest
   - delete contest
   - verify deletion

2. League CRUD
   - Status: In Progress
   - create league
   - list owned leagues
   - fetch league detail
   - update settings

3. Member and Invitation CRUD
   - invite by email
   - generate invite link
   - accept invite
   - list members
   - self-leave or remove member

4. Contest Entry CRUD
   - create current-user entry
   - list entries
   - fetch current-user entry
   - delete current-user entry

5. Draft Session Flow
   - create contest with supported MVP selection type
   - create entry/entries
   - read room state
   - submit selection/pick
   - verify read-after-write state

6. Standings and Results Read Flow
   - create minimal persisted scoring/standing records
   - verify results/standings endpoints return expected DTO shape

## Worker Split Later

Once the first two or three rebuilt suites are green and stable, split future batches by domain:

- Worker 1: league + membership CRUD
- Worker 2: contest entry + draft CRUD
- Worker 3: standings/results/history read flows

Keep shared test helpers and route-contract changes on the main thread.

## Acceptance Criteria

- Legacy database-heavy integration suites remain deleted.
- Each new integration suite is self-contained and independently runnable.
- New suites pass against real local Postgres when run outside the sandbox as needed.
- New suites use current DTOs, route behavior, and shared domain enums.
