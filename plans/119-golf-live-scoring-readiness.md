# Golf Live Scoring Readiness

Beads epic: `pool-master-eux`

## Purpose

This plan is the narrative companion for the Golf live-scoring epic. It captures the decisions from the sync review and live-scoring design discussion so implementation can proceed without rediscovering old generic scoring concepts or relying on chat history.

This plan is intentionally scoped to live scoring, Golf leaderboard reads, and event-completion settlement. Schedule, field, odds, ranking, sync orchestration, sync diagnostics, stale-data cleanup, and old route/workflow removals are tracked in the separate `pool-master-rop.68.*` sync refactor epics.

## Current Code Facts

PoolMaster already persists per-round Golf data in `SportEventParticipantGolfRound`, keyed uniquely by `sportEventParticipantId + round`. The current model stores `strokes` and `scoreToPar`, but it does not store `thru`, and it does not maintain a reusable event-level golfer standing/read model.

Root-admin event participant mapping currently derives an aggregate `scoreToPar` by summing `golfRounds`. That proves the raw data can support a total, but root-admin mapping is the wrong owner for member leaderboard behavior. Member-facing leaderboard APIs must be driven by shared Golf read models and service/query logic, not by an admin-only mapper.

Existing public standings/scoring APIs are too generic for Golf:

- `StandingsService` exposes entry rank/total shape, not an expanded Golf roster leaderboard.
- `ScoringService.getLeaderboard` sorts higher-is-better, which is unsafe for Golf.
- `ContestEntry.totalScore`, `ContestEntry.standingsPosition`, `ContestEntryPickGolfRosterContribution`, `scoreGolfRoster`, `DEFAULT_GOLF_ROSTER_SCORING_CONFIG`, and active Golf `SUM_TOP_N_ENTRIES` are legacy generic scoring artifacts and must be removed, not deprecated in place.

`IngestionPersistence.persistEvents` upserts `sport_events` and activates contests on `IN_PROGRESS`, but there is no symmetric event-completed domain event/handler or contest completion cascade today. Completion and settlement are part of this epic.

## Locked Decisions

PoolMaster has one terminal event status for this lane: `COMPLETED`. We will not add `OFFICIAL`.

Schedule sync is the authority for event completion. Live stats stopping is not enough to mark the event or contests complete, because playoffs, corrections, and official completion timing can lag the final live leaderboard movement.

Live polling only selects `IN_PROGRESS` events. When schedule sync marks an event `COMPLETED`, the event naturally drops out of live polling; no separate stop-poll action is needed.

Ordinary live-score polling updates event-side data only:

- `SportEventParticipantGolfRound`
- `SportEventParticipantGolfStanding`
- sync/write diagnostics

Ordinary live-score polling must not fan out across every contest and entry on every poll.

Contest entry picks remain pointers only. A pick selects a `SportEventParticipant`; it must not copy golfer score data.

Counting/dropped pick state is computed at leaderboard read time from contest configuration and current event standings. It is not persistently flipped during every live update.

The first implementation does not need a durable outbox for the live-scoring handoff. Provider polling and persistence are idempotent; if an in-process notification is missed, the next poll/read recovers from persisted rows.

Raw provider/debug payloads remain secondary diagnostics. Normalized persisted/read models drive application behavior.

A shared short-lived leaderboard cache may be useful later, but it is deferred from the first implementation.

## Provider Assumptions

The real provider contract remains partially unknowable without a Data Golf subscription. For now, implementation should use the public API documentation and what was learned from the docs during planning.

The likely canonical source is Data Golf's in-play/live leaderboard family rather than historical raw data. We do not need optional enrichment from `live-tournament-stats` for PoolMaster's first live leaderboard.

Data Golf may not provide every field in the exact shape we want. In particular, event strokes availability is not confirmed without subscription access. PoolMaster will still add `strokes` to the mock provider and model the desired normalized contract now. If Data Golf does not provide strokes directly, a later provider-adapter slice will derive or omit according to the real payload and a confirmed par/source strategy.

Production live cadence is 5 minutes. QA scheduled cadence is 15 minutes. Manual event sync remains the likely primary QA path while validating scenarios.

Normalized live golfer status values are:

- `active`
- `in-progress`
- `complete`
- `withdrawn`
- `missed-cut`

Playoff/extra-hole behavior is modeled through round/thru/score movement and event completion timing, not by adding a `playoff` status enum value in the first pass.

## Data Golf Public Docs Findings

Source: Data Golf API Access, https://datagolf.com/api-access.

The public Data Golf API documentation confirms these implementation inputs:

- API access requires a Scratch Plus subscription and API key.
- The shared API rate limit is 45 requests per minute across all endpoints.
- `get-schedule`: `https://feeds.datagolf.com/get-schedule?tour=[tour]&season=[season]&upcoming_only=[upcoming_only]&file_format=json&key=API_TOKEN` covers primary tour season schedules and includes event names/IDs, course names/IDs, locations, and winners for completed tournaments.
- `preds/in-play`: `https://feeds.datagolf.com/preds/in-play?tour=[tour]&dead_heat=[dead_heat]&odds_format=[odds_format]&file_format=json&key=API_TOKEN` is a live model endpoint for ongoing PGA, DP World, opposite-field PGA, Korn Ferry, and LIV/alternate events. Its public description says it updates at 5-minute intervals and returns live finish probabilities.
- `preds/live-tournament-stats`: `https://feeds.datagolf.com/preds/live-tournament-stats?stats=[stats]&round=[round]&display=[display]&file_format=json&key=API_TOKEN` returns live strokes-gained and traditional stats by round or event cumulative, but this is enrichment, not required for PoolMaster's first member leaderboard.
- Historical raw data endpoints are explicitly historical archive endpoints and are not the source for live scoring.

The public docs do not expose enough JSON shape to prove all PoolMaster-required live score fields. Until we have subscription payloads, the following remain subscription-gated:

- exact event identifier field and whether it matches `get-schedule` event IDs directly
- exact player identifier field and whether it matches `field-updates` player IDs directly
- whether live rows include total event score relative to par
- whether live rows include current-round score relative to par
- whether live rows include `thru`
- whether live rows include event strokes and/or current-round strokes
- whether live rows include a first-class player status
- whether `get-schedule` exposes a machine status or only completed-tournament winner fields

PoolMaster's first normalized target remains the shape needed by the app: event ID, participant ID, player name, round, event total relative to par, current-round score relative to par, `thru`, strokes, and normalized status. The mock provider will implement that target now. A future Data Golf adapter slice must validate subscription payloads against this target before enabling production Data Golf live scoring.

## Event-Side Model

`SportEventParticipantGolfRound` remains one row per event participant per round. It needs `thru` added so in-progress display can show how many holes have been completed.

Add `SportEventParticipantGolfStanding` as the maintained event-level golfer aggregate/read model. This is the canonical source for member leaderboard ordering and event participant display. It should support:

- event score relative to par
- event strokes
- current round
- current-round thru
- normalized status
- position/display position where available or derivable
- provider `asOf` / update timestamps

`TOT` is always the current event total relative to par.

`THR` is shown while the golfer's current round is in progress. It is not shown once the golfer has completed the relevant round.

Round columns use Golf display semantics:

- For an in-progress round, show the current round score relative to par, not raw current strokes like `47`.
- For a completed round, show final round strokes.

## Live Polling Flow

Live polling is event-scoped and goes through the retained admin provider event-sync/operator API and shared orchestrator. Direct `/api/v1/ingestion/*` score/result routes are gone and must not be reintroduced.

The scheduler selects eligible live-score candidates by persisted event state. The normal candidate set is `IN_PROGRESS` Golf events with provider support and required field/readiness data. `COMPLETED` events are not live-polled.

Each live poll:

1. Calls the provider adapter for event-scoped live scoring.
2. Normalizes provider rows into event participant round/standing data.
3. Upserts round rows and standing rows idempotently.
4. Records diagnostics for returned/created/updated/unchanged/skipped rows.
5. Does not recalculate every contest entry.

Manual event sync uses the same orchestrator and persistence path as scheduled sync. The only difference is invocation and actor/source metadata.

## Golf Leaderboard Read Flow

The member-facing Golf contest leaderboard is a read API tailored to Golf. It does not use `ContestEntry.totalScore` as the score source.

The leaderboard should load:

- contest configuration
- contest entries
- entry picks
- all relevant event participants
- `SportEventParticipantGolfStanding` rows
- `SportEventParticipantGolfRound` rows

The API joins this data in memory so Rory McIlroy's event data is fetched once for the contest event, not once per entry that selected him.

The leaderboard computes entry score from the contest's Golf selection rule. For the first roster contest, that means selecting the best N counting golfers from the entry's picks and marking the rest as dropped/crossed out in the response.

The response must support entry/team rows plus expanded golfer detail rows, including `TOT`, `THR`, `R1`, `R2`, `R3`, `R4`, counting/dropped flag, and status display. Lower total score is better for Golf.

Future caching may cache the shaped leaderboard for a short interval shared across members of the same league/contest, but that is explicitly deferred.

## Completion And Settlement

Schedule sync marks `SportEvent.status = COMPLETED`.

On transition to `COMPLETED`, PoolMaster must:

1. Compute final Golf leaderboard results from persisted event standings/rounds and contest config.
2. Persist final `ContestEntryGolfStanding` rows.
3. Mark contests related to the event as `COMPLETED`, including contests linked through `Contest.sportEventId` and `ContestSportEvent`.
4. Emit `contest.completed`.

Repeated completed schedule syncs must be idempotent.

The event can have live stats where all golfers are through round 4 and still not be completed. That state is allowed. The event and contests complete only after the schedule feed says the event is `COMPLETED`.

## Mock Provider Alignment

The mock provider exists so PoolMaster can build, run automated tests, and perform manual syncs without hitting paid provider limits. It should mirror the real provider strategy as closely as practical, not invent a separate PoolMaster-only scoring approach.

The mock live payload should include:

- event ID
- participant/provider player ID
- player name
- round
- event total score relative to par
- current-round score relative to par
- thru
- strokes
- normalized status

The mock provider should support deterministic states:

- before live
- round 1 in progress
- round 1 complete
- round 2 complete
- correction
- round 4 complete while schedule is not yet completed
- playoff/extra-hole movement
- completed event in schedule
- late correction

Schedule completion is independent from frozen live stats. The leaderboard may stop moving before the event is officially completed.

## Legacy Removal Scope

This epic should remove legacy concepts rather than leaving them as "deprecated" source:

- `ContestEntry.totalScore`
- `ContestEntry.standingsPosition`
- `ContestEntryPickGolfRosterContribution`
- `scoreGolfRoster`
- `GolfRosterScoringConfig.roundsCount`
- `DEFAULT_GOLF_ROSTER_SCORING_CONFIG`
- active Golf use of `SUM_TOP_N_ENTRIES`

All code references must be removed or replaced, including services, mappers, DTOs, OpenAPI, generated clients, UI columns, fixtures, and tests. The replacement is Golf-specific event standings plus Golf-specific contest leaderboard/settlement models.

`pool-master-eux.5` completed this legacy removal scope. It removed the generic score fields, contribution/prize/participant-score tables, generic scoring/standings services, rollup/consumer surfaces, stale generated contracts, and active UI/test references. History endpoints that previously depended on generic completed-entry totals now intentionally return empty/not-found until `pool-master-eux.6` lands `ContestEntryGolfStanding` settlement and the replacement history read path.

## Implementation Slices

Task state lives in Beads. The child stories for this plan are:

- `pool-master-eux.1` - Spike Data Golf live scoring endpoint contract.
- `pool-master-eux.2` - Add Golf round thru and participant standing model.
- `pool-master-eux.3` - Gate live polling and persist event-side live diagnostics.
- `pool-master-eux.4` - Build expanded Golf contest leaderboard read API.
- `pool-master-eux.5` - Remove legacy generic Golf scoring model.
- `pool-master-eux.6` - Implement schedule-driven event completion settlement.
- `pool-master-eux.7` - Align mock provider with Golf live scoring contract.
- `pool-master-eux.8` - Verify Golf live scoring and completion end to end.

## Test Strategy

Tests should prove:

- event-side live sync updates round and standing rows idempotently
- in-progress rounds move the member leaderboard
- ordinary live polls do not update every contest entry
- counting/dropped picks are computed from contest config at read time
- completed schedule sync computes and freezes final contest standings
- related contests become `COMPLETED`
- completed events are not selected for live polling
- mock provider states cover in-progress, correction, completion, and idempotent rerun behavior

Provider uncertainty should be represented as adapter-level tests and sanitized fixtures only. Production code must not contain guessed provider fallback data or test-mode branches.

## Deferred Or Explicitly Open

Exact Data Golf payload shape remains subscription-gated. The first slice should document what the public docs support and capture any subscription-only gaps as explicit follow-up risk.

If Data Golf does not provide event strokes directly, a future provider-adapter slice must choose a confirmed derivation/par source strategy before production Data Golf enablement.

Short-lived leaderboard caching is deferred until real usage justifies the complexity.

A durable outbox for live-scoring fanout is deferred. Idempotent polling/upserts are the recovery mechanism for the first implementation.
