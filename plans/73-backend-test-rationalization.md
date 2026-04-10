# Plan 73: Backend Test Rationalization

## Objective

Rationalize the backend test catalog so the repository has one clear testing model:

- `unit`
- `data integration`
- `contract verification`
- `functional API (FAPI)`

This plan should remove ambiguous overlap, preserve unique confidence signal, and eliminate leftover test debt from older pre-SDK and pre-refactor strategies without forcing artificial non-overlap between suites.

## Desired End State

- Every backend test file has a clear suite purpose.
- Functional API tests are the primary client-visible acceptance gate.
- Contract verification remains thin and representative.
- Data integration acts as persistence-layer unit proof for CRUD, queries, and DB-backed state behavior.
- Duplicative legacy integration files are removed.
- Rules, filenames, and plan language use the same taxonomy.

## Scope

In scope:
- backend test inventory under `tests/unit/`, `tests/integration/core-api/`, and `tests/functional/`
- classification of remaining data integration files
- pruning or replacement of lower-signal duplicates
- rule and plan updates when categorization changes

Out of scope:
- frontend test rationalization
- browser E2E rebuild
- changing service behavior solely to satisfy test categorization

## Suite Definitions

1. `Unit`
- isolated logic
- no DB
- intentional mocks allowed
- prove business logic and branch behavior here whenever it can be isolated cleanly

2. `Data Integration`
- real DB
- `Fastify.inject()` / service / repository edges
- persistence-layer unit proof:
  - CRUD
  - query correctness
  - filtering, sorting, joins, aggregations
  - fallback reads
  - integrity constraints
  - lower-level runtime invariants

3. `Contract Verification`
- representative DTO/OpenAPI response shape checks on live routes
- thin schema drift detection

4. `Functional API (FAPI)`
- generated SDK
- real HTTP
- real service stack
- product workflows and client-visible behavior
- positive and negative API use cases
- representative parameter combinations, not exhaustive permutations already covered lower in the pyramid

## Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | Rename backend suite terminology to `unit`, `data integration`, `contract verification`, and `functional API` | Rules and live suite filenames now use the aligned taxonomy |
| Done | Inventory remaining backend data integration files and classify each as `keep`, `replace-first`, or `remove-now` | The remaining `tests/integration/core-api/*.integration.ts` files are now explicitly classified below against the refined suite heuristics |
| Done | Remove files classified `remove-now` | Removed duplicated `contest-entry-crud.integration.ts` and `squad-management.integration.ts` after validating the remaining FAPI and data-integration suites |
| In Progress | Add missing FAPI coverage before deleting any `replace-first` data integration file | The next gaps are league update/settings, member lifecycle, broader permission denial coverage, and fuller draft room journeys |
| Not Started | Mark permanent `keep` files as persistence-edge or lower-level runtime coverage in notes/docs | Make the reason for keeping them explicit |
| Not Started | Update docs/rules/plans after the final pruning pass | Close the loop so the taxonomy stays stable |

## Classification Heuristics

Keep a `data integration` file when it proves:
- persistence correctness
- CRUD behavior
- repository/query behavior
- filtering, sorting, joins, aggregation, or read-model shaping
- DB-backed fallback logic
- recalculation/materialization behavior
- lower-level runtime invariants that are not primary client workflows

Remove a `data integration` file when:
- FAPI already proves the same workflow and client-visible outcomes
- contract verification already proves the schema alignment
- the file no longer adds unique persistence-edge signal

Treat a file as `replace-first` when:
- it still adds some workflow confidence today
- but that confidence should move into FAPI before deletion

Redundancy is acceptable when each suite is serving its intended role. The goal is not zero overlap; the goal is clear purpose and no accidental duplication from obsolete strategies.

## Current Classification Inventory

### Keep

These files still provide persistence-layer or lower-level runtime signal that should remain in `data integration`.

| File | Reason |
| --- | --- |
| `tests/integration/core-api/contract-verification-web.integration.ts` | Thin DTO/OpenAPI schema verification at the final API boundary |
| `tests/integration/core-api/contract-verification-root-admin.integration.ts` | Thin DTO/OpenAPI schema verification at the final API boundary |
| `tests/integration/core-api/contest-scoring-recalculate.integration.ts` | Persistence-heavy recalculation and materialized scoring state |
| `tests/integration/core-api/contest-scoring-results.integration.ts` | Direct scoring result persistence and correction flows |
| `tests/integration/core-api/contest-validation.integration.ts` | API validation boundary and “do not persist on invalid config” behavior |
| `tests/integration/core-api/history-read.integration.ts` | Read-model/query correctness for persisted history surfaces |
| `tests/integration/core-api/history-read-fallback.integration.ts` | DB-backed fallback history behavior that should remain proven below FAPI |
| `tests/integration/core-api/ingestion-persistence.integration.ts` | Repository-heavy ingestion persistence behavior |
| `tests/integration/core-api/roster-pick-crud.integration.ts` | Persistence-layer CRUD and integrity for roster picks |
| `tests/integration/core-api/scoring-read.integration.ts` | Query/read-model correctness from persisted scoring tables |
| `tests/integration/core-api/sport-event-participant-repositories.integration.ts` | Repository/query correctness for event participants and valuations |
| `tests/integration/core-api/standings-results-read.integration.ts` | Read-model shaping, ordering, and standings/result query behavior |
| `tests/integration/core-api/league-dashboard-read.integration.ts` | Aggregated league dashboard query behavior not yet intentionally modeled in FAPI |
| `tests/integration/core-api/contest-management.integration.ts` | Lower-level contest configuration lifecycle and update behavior |

### Replace-First

These files still add useful signal today, but their primary workflow confidence should move into FAPI before deletion.

| File | Why it is not removable yet |
| --- | --- |
| `tests/integration/core-api/budget-pick-room.integration.ts` | Draft room workflow belongs in FAPI, but the current draft FAPI slice does not yet fully replace the budget room journey |
| `tests/integration/core-api/contest-crud.integration.ts` | FAPI covers create/list/read/delete, but contest update behavior is not yet represented there |
| `tests/integration/core-api/contest-entry-negative.integration.ts` | Negative entry permutations still carry route-level workflow coverage not yet fully mirrored in FAPI |
| `tests/integration/core-api/draft-session-crud.integration.ts` | Draft creation/state/duplicate rejection should become FAPI-owned, but current FAPI coverage is not yet feature-complete enough to remove it |
| `tests/integration/core-api/draft-session-flow.integration.ts` | Tiered draft room flow belongs in FAPI, but the current draft FAPI slice is not yet a complete replacement |
| `tests/integration/core-api/league-crud.integration.ts` | FAPI covers create/list/read, but not the league update/settings path |
| `tests/integration/core-api/league-membership-crud.integration.ts` | Membership lifecycle is client-visible, but FAPI does not yet cover commissioner-managed member lifecycle deeply enough |
| `tests/integration/core-api/member-invitation-crud.integration.ts` | FAPI covers invitation create/accept, but not the full member list/remove/self-leave lifecycle |
| `tests/integration/core-api/permission-negative.integration.ts` | Negative permission matrix should eventually live in FAPI where it is client-visible, but the representative cases are not broad enough yet |

### Remove-Now

These files are already materially replaced by FAPI and do not appear to add unique persistence-layer signal.

| File | Why it is removable |
| --- | --- |
| `tests/integration/core-api/contest-entry-crud.integration.ts` | Removed. FAPI now covers create/list/read/leave/re-enter for contest entries through the generated SDK |
| `tests/integration/core-api/squad-management.integration.ts` | Removed. FAPI now covers squad create/update/list/co-manager management through the generated SDK |

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- `npx jest --config tests/jest.config.js --forceExit`
- `npm run test:service:functional-api`
- `npm run test:coverage:service:merged`
