# MVP Use-Case Coverage Matrix

> Working matrix for the active MVP. This is an execution artifact, not product
> truth. Product behavior still lives in `requirements/`.

## Purpose

Map the currently active MVP use cases to the automated layers that prove them,
and make missing proof visible.

## Layer Key

- `U` = Unit
- `DI` = Data Integration
- `CV` = Contract Verification
- `FAPI` = Functional API
- `UI` = Frontend component/MSW integration
- `E2E` = Browser E2E

## Current Policy

- Positive and negative documented use cases need automated proof at some
  layer.
- Richer browser `E2E` is intentionally deferred for now.
- Browser smoke may remain minimal while lower-layer proof is strengthened.

## Active MVP Coverage

| Use Case | Current Proof | Gaps / Notes |
|---|---|---|
| `AE-001` PoolMaster imports a new event from a provider | `U`, partial `DI` | Missing truthful proof that import produces contest-ready field/source data, not just event shells |
| `AE-002` Root admin refreshes an imported event | partial `CV`, partial `UI` | Missing `FAPI` proof for manual sync/re-ingest and negative/error cases |
| `AE-003` Root admin reviews sync-run history | `CV`, `UI` | Missing `FAPI` happy/negative path proof |
| `AE-004` Root admin triggers a manual event sync | `UI` | Missing `CV`/`FAPI` proof and missing readiness-chain proof |
| `MP-001` Mock provider exposes a golf tournament and its field | `U`, `DI` | Needs stronger readiness-chain proof against contest creation use cases |
| `CC-001` Commissioner creates a contest for a synced event | partial `UI` | Missing truthful `FAPI` for imported eligible event + managed template create path |
| `CC-002` Commissioner reviews derived contest field behavior during creation | partial `UI` | Missing backend/API proof for derived field/readiness semantics |
| `CC-003` Commissioner creates a contest that is immediately ready for team entries | partial `UI` | Missing `FAPI` proof through managed contest path |
| `TE-001` Team owner creates an entry for an open contest | `FAPI`, `UI` | Current `FAPI` centers on legacy contest flow, not imported-event managed flow |
| `TE-002` Team owner edits an open entry using the contest field | `FAPI`, `UI` | Needs proof against imported event-backed frozen field |
| `TE-003` Commissioner uses the same entry tools as a member | partial `UI` | Missing explicit permission/use-case proof at `FAPI` or browser layer |
| `TE-004` Team owner makes selections in a tiered golf contest | `UI`, partial `FAPI` | Needs stronger `FAPI` around imported-event managed contest path |
| `AS-001` Event updates automatically affect scoring and leaderboards | partial `U`, partial `DI` | Missing integrated proof from ingest/update through contest-facing leaderboard behavior |
| `AS-002` Member views the live leaderboard | `FAPI`, `UI` | Could be stronger on live-update path; current proof is more read-shape than lifecycle proof |
| `AS-003` Member browses completed contest history | `FAPI` | Still relies on direct fixture shaping rather than imported-event contest pipeline |

## Priority Gaps

1. Root-admin operational `FAPI` and contract proof
2. Imported-event managed contest `FAPI` proof
3. Scheduler/manual-sync readiness proof
4. History/results proof through the real event -> contest pipeline

## Deferred For Now

- richer contest browser `E2E`
- locked-entry/history browser journeys
- admin browser journeys beyond stable smoke

Those stay deferred until lower-layer proof is strong and deterministic
environment setup exists.
