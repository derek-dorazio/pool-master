# Mock Provider Golf Live Scoring Contract

Beads story: `pool-master-eux.7` (child of epic `pool-master-eux`, narrative companion to [`plans/119-golf-live-scoring-readiness.md`](./119-golf-live-scoring-readiness.md))

## Purpose

This plan is the implementation-level design companion for `pool-master-eux.7`. Plan 119 locks the product-level Golf live-scoring direction; this plan locks the architectural boundary between the mock provider and PoolMaster for the live-scores path, plus the wire-contract changes needed to deliver the nine deterministic live states without putting consumer-side synthesis or fallback logic into PoolMaster.

It exists because a first implementation attempt landed deterministic logic on the wrong side of the boundary. Capturing the rule and the correct shape here so the next attempt does not repeat the mistake.

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

1. Extend `ContestantRecord` in `packages/mock-contest-feed-provider/src/contracts.ts` (or add a parallel `LiveGolfContestantRecord` shape used only on the live-scores response) to carry per-round live detail. The shape mirrors the bus-side `GolfRoundUpdate`:

   ```ts
   interface LiveGolfRoundRecord {
     readonly round: number;             // 1–8
     readonly strokes: number | null;     // null permitted only if the provider doesn't expose per-round strokes
     readonly scoreToPar: number;
     readonly thru?: number;              // 0–18+; values > 18 represent extra-hole/playoff movement
     readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ';
     readonly completedAt?: string;       // ISO 8601
   }
   ```

2. Extend `mockEventStateKinds` with the new Golf live-state tokens (see *Deterministic States* below). The token list is part of the contract surface.

3. In `scenario-store.ts`, the `/scores` snapshot for Golf events is generated server-side based on the requested state token plus the scenario fixture. The store decides round count, per-round scores, statuses, thru values, and any participant-status transitions. Output is complete and deterministic — querying the same token returns the same response across runs.

4. Generated artifacts (mock provider OpenAPI + hey-api, root OpenAPI + hey-api + api-types) refreshed in the same slice.

### PoolMaster adapter (thin mapper)

1. Accepts the `mockEventState` option from `ProviderEventSyncOptions` and passes it to the mock provider via the existing `mockEventState=<token>` query string. The adapter does not inspect the token's value.

2. Receives the live-scores wire response and reshapes `contestant.rounds[]` into `GolfRoundUpdate[]` one-to-one. The wire-side per-round shape is identical to the bus-side shape, so the mapping is mechanical.

3. The mapper does NOT:
   - Branch on the value of `mockEventState`.
   - Compute, derive, or adjust any per-round score, stroke total, par value, or status.
   - Apply any fallback when `score`, `strokes`, `rounds`, or any other field is missing on a contestant — emit zero rounds for that contestant or surface the missing-field condition; do not invent values.
   - Override the provider's emission based on `participantStatus` (withdrawn, cut, etc.). If the provider wants a participant to produce a DNF round, the provider must emit the DNF round; the adapter does not synthesize it.
   - Short-circuit the HTTP fetch based on the state token. If the provider's response contains zero contestants, the adapter naturally emits zero rounds; the short circuit is not the consumer's concern.

4. The bus-boundary contract on `GolfRoundUpdate` is unchanged — only the wire-side shape gains the per-round detail.

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
| `golf-late-correction` | Event status is COMPLETED; the wire response carries a corrected R4 row for at least one named contestant. PoolMaster's polling gate (see plan 119, PR #68) currently excludes COMPLETED events from live-score polling — design review must decide whether this state is reachable through the normal sync path, through a manual override, or whether it requires lifting that gate | `completed` |

Withdrawn / cut emission is the provider's responsibility:

- Withdrawn participants emit a single DNF round (status `DNF`). The provider's `mapGolfLiveStatus`-aware standing refresh will land them on `WITHDRAWN`.
- Cut participants emit R1 + R2 only and stop. Whether the cut classification flows through `participantStatus`, a per-round status, or both is a design-review decision recorded under *Open Questions* below.

`MISSED_CUT` standing status has no inbound round-status path in `mapGolfLiveStatus` today (PR #67 review finding). This slice does not introduce a new round-level status value. If the standing-side MISSED_CUT path matters for the QA scenarios this slice supports, that extension is a separate slice.

## Existing Pre-Live Tokens (Backward Compatibility)

The current `mockEventStateKinds` enum is `'open' | 'locked' | 'live' | 'completed'`. These tokens are used by pre-`pool-master-eux.7` QA scripts. The new slice should not remove them; the four existing tokens continue to behave as they do today (single-round emission through the legacy path). The eight new `golf-*` tokens are additive.

## Required Wire-Contract Changes

In the mock provider (`packages/mock-contest-feed-provider/`):

- `src/contracts.ts`:
  - Extend `mockEventStateKinds` with the new `golf-*` tokens.
  - Add `rounds?` to `ContestantRecord` (or define a parallel `LiveGolfContestantRecord` and add it as a sibling field on `ContestFeedSnapshotResponse`).
  - Add `LiveGolfRoundRecord` interface + JSON Schema for the per-round shape.
- `src/scenario-store.ts`:
  - Add a deterministic per-state Golf live-scores builder.
  - Route `golf-*` tokens through it; route legacy tokens through the existing path.
  - Validate parsed `rounds[]` content during scenario-fixture loading.
- Generated `openapi.json` + `hey-api` artifacts refreshed.

In shared (`packages/shared/dto/ingestion.dto.ts`):

- Extend `MockEventStateSchema` (Zod enum) to mirror the mock provider's `mockEventStateKinds`.

In PoolMaster (`packages/core-api/src/modules/ingestion/adapters/`):

- Reduce `MockContestFeedAdapter.getLiveScores` to a thin one-to-one mapper. Remove all state-token forks, score math, fallbacks, overrides, and short-circuits.

Generated root `openapi.json` + `hey-api` + `api-types` refreshed.

## Implementation Sequencing (Suggested)

1. Extend the mock provider's contracts + JSON schemas to support `rounds`.
2. Add the scenario-store builder + route the new tokens.
3. Regenerate the mock provider's OpenAPI + hey-api.
4. Extend the shared `MockEventStateSchema`.
5. Refresh root OpenAPI + hey-api.
6. Reduce the PoolMaster adapter to a one-to-one mapper.
7. Tests:
   - Mock provider scenario-store tests covering each `golf-*` state's wire shape (run inside the mock provider package).
   - PoolMaster adapter tests covering the one-to-one mapping (no per-state branching in test setup — feed the adapter the wire shape and assert it passes through unchanged into `GolfRoundUpdate[]`).
8. Close `pool-master-eux.7` in Beads.

This sequencing keeps the mock provider's wire surface coherent before PoolMaster starts consuming it.

## What This Plan Does NOT Cover

- `pool-master-eux.3`, `.4`, `.5`, `.6`, `.8` (other epic children with their own scope).
- Production Data Golf adapter behavior (subscription-gated; out of scope per plan 119).
- Schedule-driven event completion semantics (already locked in plan 119).
- Standing-side `MISSED_CUT` round-status inbound path (PR #67 follow-up; separate slice).
- Tightening the polling-gate behavior for `golf-late-correction` reachability (recorded as an open question).

## Open Questions for Design Review

1. **Wire shape placement** — Does the per-round detail belong as `rounds?` on `ContestantRecord` (one optional field used only on the live-scores response, ignored on other snapshot kinds) or as a parallel `LiveGolfContestantRecord` shape returned only by the `/scores` endpoint? The first is smaller; the second is cleaner.

2. **Score generation in the store** — The existing `scoreRelativeToPar` helper in `scenario-store.ts` already produces deterministic single-score output using an FNV-1a hash on `(eventSeed, tick, participantId, decimalOdds)`. Should the new per-round drift extend that helper (different `tick` per round?) or be a parallel function?

3. **Cut classification path** — When the scenario calls a contestant `cut`, should the wire response set `participantStatus: 'cut'` on the contestant *and* stop emitting rounds after R2, or only stop emitting rounds? Picking both makes the data more legible; picking only one keeps the consumer-side inference simpler.

4. **`golf-late-correction` reachability** — PR #68's live-polling gate currently filters event candidates to `IN_PROGRESS` status only. A `golf-late-correction` state produces a COMPLETED upstream event. Is this state intended to be reached through:
   - Manual root-admin event sync (orchestrator path, not the polling gate)
   - A relaxation of the polling gate for this specific state
   - Documentation only (operators know to trigger this manually)?

   The mock provider should still produce the correct wire shape regardless; this question is about how QA reaches it.

5. **Playoff representation locking** — Plan 119 locks "playoff/extra-hole movement is modeled through round + thru + score, not via a `playoff` status enum." The proposed wire shape uses `round: 5, thru: 19+`. Confirm before locking it into the wire schema.

6. **Withdrawn vs DNF semantics** — The provider's withdrawn emission is a single DNF round. Should that DNF round carry `round: 1` (truncated emission) or `round: <current round at time of withdrawal>`? Both are reasonable; pick before implementation.

7. **`completedAt` field** — Should the wire-side `LiveGolfRoundRecord` populate `completedAt` for COMPLETED rounds? It's optional in `GolfRoundUpdate`. The mock provider could supply a deterministic ISO timestamp derived from `event.schedule.startsAt + round_offset`, but the value would have no real semantic for downstream consumers other than ordering.

8. **Fixture validation** — Scenario fixtures currently validate single-score `results` contestants. The new `rounds[]` will need parser + cross-reference validation (no rounds reference unknown contestants, statuses are coherent across rounds for a participant, etc.). What validation belongs in `validateScenario` vs the deterministic builder?

9. **Worktree workflow convention** — Independent of this slice, the first attempt was disrupted by parallel work on a shared checkout. Should the team adopt a documented convention to use `git worktree add` when multiple agents may be active on the same repo? Captured here because it surfaced during this plan's drafting; route to `rules/workflow-rules.md` if accepted as a durable convention.

## References

- `plans/119-golf-live-scoring-readiness.md` — parent epic narrative; locks schedule-driven event completion, the normalized standing status set, and the mock-provider alignment goal.
- `packages/mock-contest-feed-provider/src/contracts.ts` — current wire contract surface for the mock provider.
- `packages/mock-contest-feed-provider/src/scenario-store.ts` — current Golf live-scores builder (`buildLiveGolfScores`, `applyMockEventState`).
- `packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts` — current adapter (still in the pre-`pool-master-eux.7` shape on `main`).
- `packages/shared/dto/live-score.dto.ts` — bus-boundary `GolfRoundUpdate` shape the adapter targets.
- `packages/core-api/src/modules/ingestion/core/score-publisher.ts` — `mapGolfLiveStatus` (collapses round-level status into standing status).
