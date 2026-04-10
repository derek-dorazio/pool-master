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
| In Progress | Inventory remaining backend data integration files and classify each as `keep`, `replace-first`, or `remove-now` | First pruning wave removed duplicated auth-session and consent integrations; remaining inventory still needs explicit classification against the refined suite heuristics |
| Not Started | Remove files classified `remove-now` | Only delete files whose signal is already fully replaced by FAPI plus contract verification |
| Not Started | Add missing FAPI coverage before deleting any `replace-first` data integration file | Replace behavior signal before pruning |
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

## Validation

- `npx turbo typecheck --force`
- `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- `npx jest --config tests/jest.config.js --forceExit`
- `npm run test:service:functional-api`
- `npm run test:coverage:service:merged`
