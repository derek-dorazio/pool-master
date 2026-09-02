# Golf Official-Results Finalization & Event Closeout

> **Parent Beads epic:** `pool-master-q68` — *Golf official-results finalization & event closeout*

## Purpose

Close the loop on Golf event completion. Today an event flips to `COMPLETED` (provider-owned, via the mock lifecycle hardened in `pool-master-33l.8` / PR #74), settlement runs once off the **live-derived** standings, and the `EVENTRESULTS` feed is fetched but its payload is discarded. There is no `OFFICIAL` transition, no persistence of final results, and no mechanism to apply post-completion corrections.

This plan defines the work to make event closeout authoritative: after `COMPLETED`, PoolMaster includes the event in scheduled `EVENTRESULTS` provider calls until it obtains **official** final results, persists the final participant adjustments, transitions the event `COMPLETED → OFFICIAL`, and finalizes contest settlement against the official standings. The mock Data Golf provider must simulate the official transition a configurable delay after the simulated finish so the loop is exercisable in QA without manual state tokens.

`OFFICIAL` is workflow-first, not UI-first. The reason PoolMaster needs a
post-`COMPLETED` state is that `EVENTRESULTS` is a separate provider API/feed
whose eligibility begins when the provider marks the event `COMPLETED`.
PoolMaster may need to include that event in one scheduled results run, or in
multiple scheduled runs until official results are available. Once the results
payload has been successfully applied, the event must leave `COMPLETED` so that
event ID is no longer selected for future `EVENTRESULTS` provider calls.

The scheduled results loop itself still runs on its configured interval. When
there are no eligible `COMPLETED` event IDs, it should not call the provider's
results API; it should log an expected "no events to fetch results" condition
and wait for the next interval.

The UI may still expose this state. In particular, `OFFICIAL` can be the
condition that moves related contests out of active contest surfaces and into
historical contest surfaces. If the results payload changes event participant
data, scores, or standings, those changes must also update/finalize the
contest-facing standings derived from those participants.

The already-built member leaderboard is not being redesigned here. Members
already use the contest leaderboard throughout live play, and the leaderboard
should continue to read from current event participant standings. The remaining
UI/listing change is narrower: completed-but-not-yet-official contests should
remain findable in active contest surfaces, and related contests should move to
history only after the linked event becomes `OFFICIAL`.

## Governing principles

- `rules/service-rules.md` — provider/feed boundaries; shared enums/constants over bare string literals (§19); no mock/fallback data in production paths.
- `rules/architecture-rules.md` — provider selection is config-driven; PoolMaster speaks only to the `SportDataProvider` port.
- `rules/testing-rules.md` — §1B forbidden application-code patterns (no synthesized/fallback data); §1A traceability; §3 defect protocol.
- `requirements/.../sports-data-providers/overview.md` and `plans/119-golf-live-scoring-readiness.md` — Data Golf is the modeled real provider (`preds/in-play` for live, `get-schedule` winners / historical archive for final).
- `plans/121-mock-provider-golf-live-contract.md` — "the mock provider is the data source"; all score/status math stays server-side in the mock package.

## Verified current state (as of PR #74 review, 2026-06-04)

| Concern | Current behavior | Location |
|---|---|---|
| Mock lifecycle | `RelativeGolfLifecyclePhase = open｜field_locked｜in_progress｜completed`; no time-driven official/corrected phase. `corrected → OFFICIAL` only via manual `golf-correction` / `golf-late-correction` tokens | `packages/mock-contest-feed-provider/src/scenario-store.ts` |
| Results persistence | `fetchEventResults` calls `getEventResults` then only logs/counts — *"no live-score bridge — rop.78.7 rebuilds"*. `rop.78.7` actually closed with contribution-table scope, so the bridge was never rebuilt | `packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts:374` |
| `OFFICIAL` status write | None. `OFFICIAL` appears only in the reader filter and the `ProviderEventResult` type | `scheduled-event-reader.ts:73`, `provider-interface.ts:162` |
| Settlement trigger | Fires when `sportEvent.status === 'COMPLETED'` using live-derived golf standings | `golf-contest-settlement-service.ts:58`, `ingestion-persistence.ts:207` |
| Poll loop | Reader selects `status IN [COMPLETED, OFFICIAL] AND updatedAt >= now-24h`; ages out by time, no clean eligible-event removal once official results are applied | `scheduled-event-reader.ts:71` |
| Member leaderboard | Reads current `SportEventParticipantGolfStanding` / round rows and computes entries on read; not tied to history classification | `contests/service.ts:getGolfLeaderboard` |
| Active/history UI split | Currently treats `ContestStatus.COMPLETED` as historical, without access to linked event status | `clients/poolmaster/src/features/contests/contest-status.ts` |
| History reads | Currently filter by `ContestStatus.COMPLETED`, without requiring linked event `OFFICIAL` | `history-service.ts:findGolfStandingRows` |

## Desired end state

1. A simulated tournament advances `field_announced → in_progress → completed → official` purely by the clock.
2. PoolMaster includes `COMPLETED` golf events in scheduled `EVENTRESULTS` provider calls until the provider returns `OFFICIAL` results.
3. Official results are persisted to the canonical golf per-participant tables as the authoritative final values.
4. The event transitions `COMPLETED → OFFICIAL`; it then drops out of the results-eligibility query, so its event ID is no longer sent to the provider results API.
5. Existing contest leaderboard reads continue to serve current/final standings while related contests remain active at event `COMPLETED`.
6. Final contest standings reflect official results, applying any corrections that landed after the live feed froze.
7. Contest list/history classification uses the linked event closeout state: `COMPLETED` event remains active; `OFFICIAL` event moves related contests to history.

## Decision updates

- **`COMPLETED → OFFICIAL` supersedes plan 119's earlier "no `OFFICIAL`"
  decision.** Plan 119 treated `COMPLETED` as the only terminal Golf event
  state. That was adequate before the `EVENTRESULTS` closeout workflow was
  examined. Plan 122 changes that decision because the results feed needs a
  persisted, idempotent stop condition after official results are applied.
- **The status transition is feed-control first, but UI-visible.** UI wording
  can expose "Official" as the visible event label and use it as the active →
  historical contest boundary. The existing leaderboard read model remains the
  source for member standings while official results are pending. Implementation
  should still model `OFFICIAL` because `COMPLETED` events remain eligible for
  scheduled `EVENTRESULTS` provider calls only until the authoritative payload
  has been consumed.

## Slice breakdown (child stories of `pool-master-q68`)

- **`pool-master-q68.1`** — Mock: time-driven `official`/`corrected` phase after completion (configurable delay constant).
- **`pool-master-q68.2`** — Ingestion: persist `EVENTRESULTS` final standings + participant adjustments (rebuild the dropped bridge).
- **`pool-master-q68.3`** — Lifecycle: `COMPLETED → OFFICIAL` transition + eligible-event selection until official (bounded), reading from provider results status; fold in the shared-enum cleanup for `scheduled-event-reader.ts`.
- **`pool-master-q68.4`** — Contest finalization + listing/history boundary: re-finalize contest standings from official event results, expose enough linked event closeout state in contest summaries for active/history filtering, and update history reads to require linked event `OFFICIAL`.

Sequencing: q68.1 unblocks end-to-end testing; q68.2 → q68.3 → q68.4 are ordered. Per `rules/workflow-rules.md`, live status/sequencing lives in Beads, not in this file.

## Open questions

1. **Data Golf "official" semantics.** Does Data Golf expose a distinct official/final flag, or is the canonical final source `get-schedule` winners / the historical-archive endpoints (per `plans/119`)? The "X minutes after completion → OFFICIAL" delay is a **QA/mock modeling choice** until subscription payloads confirm real semantics. A future real-adapter slice must reconcile. Current PoolMaster and mock-provider contracts already include an event results feed, so this plan defines the local workflow needed to complete that feed loop even before the exact Data Golf payload is confirmed.
2. **Provisional vs. wait-for-official settlement rows.** The active/history boundary is decided: related contests stay active at event `COMPLETED` and move to history at event `OFFICIAL`. The remaining implementation decision is narrow: keep the existing completed-event settlement as a provisional snapshot and re-finalize it on `OFFICIAL`, or defer writing `ContestEntryGolfStanding` history rows until `OFFICIAL` while the existing leaderboard read model continues serving active results.
3. **Polling budget.** What max-wait / retry cap replaces the implicit 24h `updatedAt` window before PoolMaster gives up waiting for official results, and what is the operational signal when it does?
4. **Idempotency of corrections.** When official results differ from the live-frozen standings (scorecard corrections, late withdrawals), how are already-published standings/settlement amended without double-applying?

## References

- PR #74 (`pool-master-33l.8`) — provider-owned mock golf lifecycle (the `COMPLETED` end-state this plan builds on).
- `plans/119-golf-live-scoring-readiness.md`, `plans/121-mock-provider-golf-live-contract.md`.
