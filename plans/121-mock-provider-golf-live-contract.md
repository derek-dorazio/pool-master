# Mock Provider Golf Live Scoring Contract

Beads story: `pool-master-eux.7` (child of epic `pool-master-eux`, narrative companion to [`plans/119-golf-live-scoring-readiness.md`](./119-golf-live-scoring-readiness.md))

## Purpose

This plan is the implementation-level design companion for `pool-master-eux.7`. Plan 119 locks the product-level Golf live-scoring direction; this plan locks the architectural boundary between the mock provider and PoolMaster for the live-scores path, plus the wire-contract changes needed to deliver the nine deterministic live states without putting consumer-side synthesis or fallback logic into PoolMaster.

It exists because a first implementation attempt landed deterministic logic on the wrong side of the boundary. Capturing the rule and the correct shape here so the next attempt does not repeat the mistake. That rejected attempt also closed the Beads story with the wrong conclusion; `pool-master-eux.7` must remain open until the provider owns the deterministic wire payloads and PoolMaster's adapter is only a mapper.

## Architectural Rule (Governing)

**PoolMaster is a consumer of sync data.** Its code in this lane must:

- React only to what arrives in the sync response payload.
- Derive behavior from persisted `SportEvent` status and the fields in the payload — never from the request token that was used to fetch it.
- Contain no hardcoded scenario logic, no state-token forks, no per-round score math, no fabricated constants, and no synthesis/fallback for missing fields.

**The mock provider is the data source.** Its server-side code owns:

- The full deterministic content of every supported scenario.
- The shape of the wire response for every supported `mockEventState` token.
- All per-round score generation, status transitions, and edge-case data (withdrawn, cut, playoff/extra-hole).

**The HTTP wire contract is the boundary.** Anything QA can request via `mockEventState=<token>` must produce a complete, deterministic, multi-round response server-side. A direct `curl` against the mock provider's `/scores` endpoint with a state token must return the same shape PoolMaster's adapter will consume. The adapter is a thin one-to-one mapper from the wire response into the bus-side `GolfRoundUpdate[]`.

## What Was Attempted and Rejected (Anti-Pattern Reference)

The first implementation attempt for `pool-master-eux.7` extended `mockEventStateKinds` with eight new `golf-*` tokens but then placed all the multi-round emission logic in PoolMaster's `MockContestFeedAdapter`. The wire response from the mock provider's `/scores` endpoint was left unchanged (single score per contestant), and the adapter synthesized the multi-round shape based on the requested token.

That implementation contained, in PoolMaster, every category of code the architectural rule forbids:

- A per-state `state-machine fork` (`buildContestantRoundEmission`) that decided round count and shape based on the state token.
- Per-round score math helpers (`secondRoundScoreFor`, `thirdRoundScoreFor`, `fourthRoundScoreFor`, `playoffRoundFourScoreFor`).
- Hardcoded constants (`GOLF_ROUND_PAR = 72`, `GOLF_CORRECTION_DELTA = 5`, `GOLF_LATE_CORRECTION_DELTA = 2`).
- A score fallback (`baselineScoreForContestant`) that invented a per-index value when the contestant lacked a `score`.
- A withdrawn-status override that replaced the provider's emission with a forced DNF row.
- An early-return short circuit that skipped the HTTP fetch entirely when the state token was `golf-pre-live`.

Practical consequences:

- A direct `curl` against `/v1/scenarios/X/events/Y/scores?mockEventState=golf-r2-complete` returned single-score data, not multi-round data — diverging from what PoolMaster actually received.
- The "deterministic" data was not the provider's data; it was PoolMaster's invention conditional on a request-side token.
- The withdrawn override meant the provider could not, even in principle, control the emission shape for those participants.
- The fallback masked real data defects (a missing `score` should be a provider problem, not a consumer-synthesized value).

This plan exists so the next attempt avoids each of those failure modes.

## Required Architecture

### Mock provider (owns everything below)

1. Add a `/scores`-specific live response shape rather than adding `rounds?` to the generic `ContestantRecord`. The live response should use a `LiveGolfContestantRecord` with a required `rounds` array. This keeps schedule, field, odds, rankings, and results snapshots from inheriting live-only optional fields and makes it impossible for PoolMaster to keep consuming the old single-score `/scores` shape by accident.

   ```ts
   interface LiveGolfRoundRecord {
     readonly round: number;             // 1–8
     readonly strokes: number;            // mock provider must emit strokes; real providers can be mapped later if unknown
     readonly scoreToPar: number;
     readonly thru?: number;              // 0–18+; values > 18 represent extra-hole/playoff movement
     readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ' | 'MISSED_CUT';
     readonly completedAt?: string;       // ISO 8601
   }
   ```

   If the current bus-side `GolfRoundUpdate` status enum does not include `MISSED_CUT`, this slice must extend that enum and `mapGolfLiveStatus` deliberately. That is not provider-specific synthesis; it is the shared normalized live-score contract required by plan 119's locked golfer status set.

2. Extend `mockEventStateKinds` with the new Golf live-state tokens (see *Deterministic States* below). The token list is part of the contract surface.

3. In `scenario-store.ts`, the `/scores` snapshot for Golf events is generated server-side based on the requested state token plus the scenario fixture. The store decides round count, per-round scores, statuses, thru values, and any participant-status transitions. Output is complete and deterministic — querying the same token returns the same response across runs. The provider may reuse existing deterministic hash helpers internally, but all score/stroke math stays inside the mock provider package.

4. Generated artifacts (mock provider OpenAPI + hey-api, root OpenAPI + hey-api + api-types) refreshed in the same slice.

### PoolMaster adapter (thin mapper)

1. Accepts the `mockEventState` option from `ProviderEventSyncOptions` and passes it to the mock provider via the existing `mockEventState=<token>` query string. The adapter does not inspect the token's value.

2. Receives the live-scores wire response and reshapes `contestant.rounds[]` into `GolfRoundUpdate[]` one-to-one. The wire-side per-round shape is identical to the bus-side shape, so the mapping is mechanical.

3. The mapper does NOT:
   - Branch on the value of `mockEventState`.
   - Compute, derive, or adjust any per-round score, stroke total, par value, or status.
   - Apply any fallback when `strokes`, `rounds`, or any other field is missing on a contestant. For the new `/scores` live shape, missing required live fields are provider contract defects and should fail validation rather than being silently repaired.
   - Override the provider's emission based on `participantStatus` (withdrawn, cut, etc.). If the provider wants a participant to produce a DNF round, the provider must emit the DNF round; the adapter does not synthesize it.
   - Short-circuit the HTTP fetch based on the state token. If the provider's response contains zero contestants, the adapter naturally emits zero rounds; the short circuit is not the consumer's concern.

4. The bus-boundary `GolfRoundUpdate` shape stays structurally the same, but its status enum must add `MISSED_CUT` so provider-emitted cut states can persist into `SportEventParticipantGolfStanding.status` without inference.

### PoolMaster everywhere else

No other PoolMaster code path should encode knowledge of the `mockEventState` token semantic. The token is a request-side parameter for QA convenience; downstream consumers (score-publisher, scheduler, leaderboard read) react to persisted event status and persisted `SportEventParticipantGolfRound` / `SportEventParticipantGolfStanding` rows — never to the token that triggered the sync.

## Deterministic States

Each state is a value of `mockEventStateKinds` that, when sent to the mock provider's `/scores` endpoint, produces a deterministic multi-round response. The state list is canonical for this slice.

| Token | Wire response contains | Upstream event status driven by store |
|---|---|---|
| `golf-pre-live` | Zero contestants on `/scores`; `field` and `odds` snapshots are intact | `field_announced` |
| `golf-r1-in-progress` | One round per contestant, `round: 1`, `thru < 18`, `status: 'IN_PROGRESS'`, partial running score | `in_progress` |
| `golf-r1-complete` | One round per contestant, `round: 1`, `thru: 18`, `status: 'COMPLETED'`, R1 strokes total | `in_progress` |
| `golf-r2-complete` | Two rounds per contestant, R1 + R2 both COMPLETED with distinct per-round scores; cut participants stop at R2 | `in_progress` |
| `golf-correction` | Same as `golf-r2-complete` plus a corrected R2 row for at least one named contestant (the wire response includes the corrected score; downstream upsert collapses to UPDATED disposition) | `in_progress` |
| `golf-r4-complete-pending-final` | Four rounds per non-cut contestant, all COMPLETED, with the upstream event status still `in_progress` (schedule has not yet marked the event COMPLETED) | `in_progress` |
| `golf-playoff` | Four COMPLETED rounds plus a fifth round for the top contestants with `thru > 18` (extra-hole movement); the winner's R5 is COMPLETED, the runner-up's R5 is IN_PROGRESS. No `playoff` status enum value introduced | `in_progress` |
| `golf-completed` (existing `completed` token retained) | Final-state rounds and results; event status flips to COMPLETED | `completed` |
| `golf-late-correction` | Event status is COMPLETED; the wire response carries a corrected R4 row for at least one named contestant. QA reaches this through manual root-admin event sync with `mockEventState: 'golf-late-correction'`; scheduled live polling remains IN_PROGRESS-only | `completed` |

Withdrawn / cut emission is the provider's responsibility:

- Withdrawn participants emit a terminal DNF round for the current round at the time of withdrawal and no later rounds. The provider, not the adapter, chooses the round number for each deterministic state.
- Disqualified participants emit a terminal DSQ round for the current round at the time of disqualification and no later rounds.
- Cut participants emit R1 + R2 only, set `participantStatus: 'cut'` on the live contestant record, and emit a terminal `MISSED_CUT` round status on R2 so `SportEventParticipantGolfStanding.status` can become `MISSED_CUT` without consumer-side inference.

`MISSED_CUT` is part of the locked golfer status set from plan 119, so this slice must not leave it as an unreachable standing status for mock-provider live scoring.

## Existing Pre-Live Tokens (Backward Compatibility)

The current `mockEventStateKinds` enum is `'open' | 'locked' | 'live' | 'completed'`. These tokens are used by pre-`pool-master-eux.7` QA scripts. The new slice should not remove them, but the `/scores` endpoint must not retain a legacy single-score path. For Golf `/scores`, legacy tokens become aliases into the provider-owned live response model:

- `open` and `locked` produce the same zero-contestant `/scores` shape as `golf-pre-live`.
- `live` produces a deterministic in-progress live response, equivalent to the closest supported Golf live token.
- `completed` produces the same final live response as `golf-completed`.

This preserves QA compatibility without keeping two live-score contracts alive.

## Required Wire-Contract Changes

In the mock provider (`packages/mock-contest-feed-provider/`):

- `src/contracts.ts`:
  - Extend `mockEventStateKinds` with the new `golf-*` tokens.
  - Define `LiveGolfContestantRecord`, `LiveGolfRoundRecord`, and a `/scores` response schema whose contestants use the live shape with required `rounds`.
  - Do not add `rounds?` to the generic `ContestantRecord`.
- `src/scenario-store.ts`:
  - Add a deterministic per-state Golf live-scores builder.
  - Route `golf-*` tokens and legacy aliases through it. Do not route any Golf `/scores` request through the old single-score path.
  - Validate generated `rounds[]` content before responding: known contestant ID, round 1–8, non-negative strokes, coherent `thru`, coherent terminal statuses, no duplicate `(contestantId, round)` rows.
- Generated `openapi.json` + `hey-api` artifacts refreshed.

In shared (`packages/shared/dto/ingestion.dto.ts`):

- Extend `MockEventStateSchema` (Zod enum) to mirror the mock provider's `mockEventStateKinds`.

In PoolMaster (`packages/core-api/src/modules/ingestion/adapters/`):

- Reduce `MockContestFeedAdapter.getLiveScores` to a thin one-to-one mapper. Remove all state-token forks, score math, fallbacks, overrides, and short-circuits.
- Its only permitted use of `mockEventState` is passing the query parameter through `withMockEventState`. Any other comparison against a concrete state token in the adapter is a plan violation.

Generated root `openapi.json` + `hey-api` + `api-types` refreshed.

## Implementation Sequencing (Suggested)

1. Extend the mock provider's contracts + JSON schemas to support `rounds`.
2. Add the scenario-store builder + route the new tokens.
3. Regenerate the mock provider's OpenAPI + hey-api.
4. Extend the shared `MockEventStateSchema`.
5. Refresh root OpenAPI + hey-api.
6. Reduce the PoolMaster adapter to a one-to-one mapper.
7. Tests:
   - Mock provider route/scenario-store tests covering each `golf-*` state's wire shape at `/v1/scenarios/:scenarioId/events/:eventId/scores?mockEventState=<token>`. These tests must assert the wire response itself includes multi-round `rounds[]`; testing only PoolMaster's mapped output is insufficient.
   - Alias tests for `open`, `locked`, `live`, and `completed` proving they return the new live response shape rather than the old single-score shape.
   - PoolMaster adapter tests covering the one-to-one mapping (no per-state branching in test setup — feed the adapter the wire shape and assert it passes through unchanged into `GolfRoundUpdate[]`).
   - A negative/static regression check or focused unit assertion proving `MockContestFeedAdapter.getLiveScores` does not inspect concrete `mockEventState` values beyond appending the query string.
8. Close `pool-master-eux.7` in Beads.

This sequencing keeps the mock provider's wire surface coherent before PoolMaster starts consuming it.

## What This Plan Does NOT Cover

- `pool-master-eux.3`, `.4`, `.5`, `.6`, `.8` (other epic children with their own scope).
- Production Data Golf adapter behavior (subscription-gated; out of scope per plan 119).
- Schedule-driven event completion semantics (already locked in plan 119).
- Tightening the scheduled live-polling gate for completed-event corrections. This plan chooses manual reachability for `golf-late-correction`; scheduled polling still excludes `COMPLETED` events.

## Locked Answers From Design Review

1. **Wire shape placement** — Use a parallel `/scores` live shape with `LiveGolfContestantRecord`; do not add live-only optional fields to `ContestantRecord`.

2. **Score generation in the store** — Keep all deterministic score/stroke generation in `packages/mock-contest-feed-provider`. Reusing existing hash helpers is fine, but PoolMaster must not contain per-state score math or fallback score generation.

3. **Cut classification path** — Emit both `participantStatus: 'cut'` and a terminal R2 `MISSED_CUT` live round. This makes the provider payload legible and gives PoolMaster an explicit normalized status path.

4. **`golf-late-correction` reachability** — Reach it through manual root-admin event sync with `mockEventState: 'golf-late-correction'`. Do not relax scheduled live polling; scheduled polling still selects only `IN_PROGRESS` events.

5. **Playoff representation** — Model extra-hole movement as `round: 5` with `thru > 18` and score movement. Do not add a `playoff` status enum value.

6. **Withdrawn / DNF semantics** — A withdrawn golfer emits one terminal DNF round in the current round for that state and no later rounds.

7. **`completedAt` field** — Populate deterministic `completedAt` values for COMPLETED, DNF, DSQ, and MISSED_CUT rounds. Leave it absent for IN_PROGRESS rounds.

8. **Validation** — Validate generated live responses before returning them from the provider route and cover that validation in provider tests. The builder is the source of the generated rounds, so validation belongs next to the builder/route contract, not in PoolMaster.

9. **Worktree workflow** — Parallel-agent worktree policy is out of scope for this plan. If we want to make that durable, update `rules/workflow-rules.md` separately rather than mixing it into the mock-provider contract.

## Implementation Guardrails

Before `pool-master-eux.7` can close, review must confirm:

- A direct request to the mock provider `/scores` endpoint with every supported `golf-*` token returns the deterministic multi-round live shape.
- The PoolMaster adapter still performs an HTTP fetch for `golf-pre-live`; zero rounds come from the provider response, not from a consumer-side short circuit.
- The PoolMaster adapter contains no concrete `golf-*`, `open`, `locked`, `live`, or `completed` token comparisons other than the existing query-string pass-through helper.
- There is no PoolMaster-side helper that resembles per-round mock scoring math, correction deltas, playoff score generation, or participant-status override.
- Missing required live-round fields fail provider/adapter validation; they are not replaced with fallback values.

## References

- `plans/119-golf-live-scoring-readiness.md` — parent epic narrative; locks schedule-driven event completion, the normalized standing status set, and the mock-provider alignment goal.
- `packages/mock-contest-feed-provider/src/contracts.ts` — current wire contract surface for the mock provider.
- `packages/mock-contest-feed-provider/src/scenario-store.ts` — current Golf live-scores builder (`buildLiveGolfScores`, `applyMockEventState`).
- `packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts` — current adapter (still in the pre-`pool-master-eux.7` shape on `main`).
- `packages/shared/dto/live-score.dto.ts` — bus-boundary `GolfRoundUpdate` shape the adapter targets.
- `packages/core-api/src/modules/ingestion/core/score-publisher.ts` — `mapGolfLiveStatus` (collapses round-level status into standing status).
