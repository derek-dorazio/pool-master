# Plan 102: Mock Provider Lifecycle Alignment

## Purpose

Align the non-production mock sports data provider with the real ingestion
lifecycle used by PoolMaster:

1. schedule sync creates sporting events
2. odds/field sync hydrates event participants
3. live scoring sync updates scores and leaderboard after the event starts

This plan removes the current ambiguity where one mock event-detail payload
tries to behave like schedule, field, odds, rankings, and live scoring all at
once.

## Problem Statement

The current mock provider contract is event-first and feed-rich, but it still
blends pre-event and live-event concerns:

- `event.field.contestants` behaves like an already hydrated event field
- `event.feeds.odds` behaves like a pre-event pricing source
- `event.feeds.results` and `updates` behave like live/final scoring

That makes it too easy for tests and manual sync flows to treat an event shell
as contest-ready before a truthful participant/odds hydration step has
occurred.

## Target Outcome

The mock provider system should model the same lifecycle we expect from real
providers:

- a pre-event catalog/odds source defines sports, events, odds, and therefore
  the participant field for golf contests
- a separate live scoring source publishes live score movement and final
  results for the same event-participant ids
- the core API adapter composes those sources so existing ingestion flows do
  not need to change all at once

## Design Decisions

### 1. Split The Mock Data Surface Into Two APIs

Keep one package for now, but expose two contract families:

- pre-event API
  - sports
  - events
  - event detail
  - odds snapshot
  - rankings snapshot
- live scoring API
  - live events
  - score snapshot / leaderboard
  - final results

These can remain inside `@poolmaster/mock-contest-feed-provider` initially, but
the contracts and datasets must be cleanly separated so later extraction into
two processes is straightforward.

### 2. Use Shared Identifiers Across Both APIs

Both APIs must use the same:

- `sport`
- `eventId`
- `participantId`

That allows:

- schedule sync to create the event shell
- odds sync to create the event participants
- live scoring sync to update those exact participants

### 3. For Golf, Odds Define The Contest Field

For golf scenarios, the event participant list should come from the event's
odds contestants.

Truthful implication:

- if a golf event has zero odds contestants, it has zero participants
- that is a dataset/ingestion error
- the event must not be contest-eligible

### 4. Keep The Core API Adapter Stable First

Do not force a broad ingestion-interface refactor in the first slice.

Instead, update
`packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts`
to behave like a composite adapter:

- `getUpcomingEvents()` reads from the pre-event API
- `getEventDetails()` reads from the pre-event API and derives participants from
  golf odds contestants
- `getParticipants()` reads from pre-event odds/field datasets
- `getRankings()` reads from the pre-event rankings dataset
- `getLiveScores()` reads from the live scoring API
- `getEventResults()` reads from the live scoring API

### 5. Make Live Golf Scores Generated, Not Hand-Curated

For live golf scenarios, do not hand-maintain a full moving leaderboard.
Instead, generate score snapshots from:

- event seed
- poll tick
- participant id
- participant odds

This keeps the dataset compact while still giving QA and scoring flows changing,
repeatable inputs.

## Proposed Live Golf Scoring Function

Use a deterministic seeded function with a bounded output range of `-20..20`
relative to par.

```ts
type ScoreInput = {
  eventSeed: string;
  tick: number;
  participantId: string;
  decimalOdds: number;
  minOdds: number;
  maxOdds: number;
};

export function scoreRelativeToPar(input: ScoreInput): number {
  const oddsFactor = normalizeLogOdds(input.decimalOdds, input.minOdds, input.maxOdds);
  const strength = 1 - oddsFactor;

  const baseline = 12 - (24 * strength);
  const volatility = 3 + (5 * oddsFactor);

  const fieldDrift = (hashUnit(`${input.eventSeed}:${input.tick}:field`) - 0.5) * 4;

  const playerNoise =
    ((hashUnit(`${input.eventSeed}:${input.tick}:${input.participantId}:a`)
      + hashUnit(`${input.eventSeed}:${input.tick}:${input.participantId}:b`)) - 1)
    * volatility;

  const rawScore = baseline + fieldDrift + playerNoise;

  return clamp(Math.round(rawScore), -20, 20);
}

function normalizeLogOdds(odds: number, minOdds: number, maxOdds: number): number {
  const safeOdds = Math.max(odds, 1.01);
  const low = Math.log(Math.max(minOdds, 1.01));
  const high = Math.log(Math.max(maxOdds, 1.01));

  if (high <= low) {
    return 0.5;
  }

  return (Math.log(safeOdds) - low) / (high - low);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

### Scoring Function Intent

- favorites trend toward negative scores
- longshots trend toward positive scores
- each poll changes the score because `tick` changes
- the same `eventSeed + tick + participantId` always yields the same value
- all outputs remain within `-20..20`

## Scope

- `packages/mock-contest-feed-provider/**/*`
- `packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts`
- mock-provider tests
- ingestion adapter tests
- any affected functional/integration tests that currently assume field and live
  scoring are bundled together

## Out Of Scope

- changing real provider contracts
- replacing the PGA adapter in this slice
- adding new commissioner-facing controls
- introducing a database for the mock provider

## Implementation Phases

### Phase 1: Split Contracts And Scenario Model

- separate pre-event and live scoring response contracts
- update scenario loader validation rules
- keep backward compatibility only where necessary for a short migration window

### Phase 2: Reshape Mock Datasets

- move golf participants to the odds/event field definition
- add explicit live scoring seeds/ticks/config for golf scenarios
- ensure live scoring participant ids exactly match the pre-event field

### Phase 3: Update Composite Mock Adapter

- read schedule/odds/rankings from pre-event endpoints
- read live scores/results from live scoring endpoints
- keep the existing `SportDataProvider` shape for now

### Phase 4: Enforce Truthful Validation

- reject golf scenarios with zero odds contestants
- reject live datasets that reference unknown participants
- reject contest-ready states when no hydrated participants exist

### Phase 5: Regenerate And Verify

- regenerate mock provider OpenAPI/client
- update unit/integration/functional tests
- verify manual sync and live scoring flows against the new datasets

## Acceptance Criteria

- Mock golf event participants come from the event odds/field feed, not from a
  separate invented field source.
- A golf event with zero participants fails scenario validation and cannot be
  treated as contest-ready.
- Live golf score polls return deterministic-but-changing participant scores
  derived from event seed, tick, and odds.
- The live golf score range is always clamped to `-20..20`.
- Core ingestion tests and mock-provider tests reflect the real lifecycle:
  schedule -> field/odds -> live scoring/results.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 102-001 | 1 | Split mock provider contracts into pre-event and live scoring surfaces | Completed | Added first-pass `/v1/pre-event/...` and `/v1/live/...` endpoint families while keeping one package/service |
| 102-002 | 2 | Rewrite golf mock datasets so odds contestants define the participant field | In Progress | Golf participant resolution now derives from odds contestants in code; scenario JSON still carries a baseline field catalog |
| 102-003 | 2 | Add seeded live golf scoring configuration and tick-based score generation | Completed | Added deterministic tick-based golf score generation clamped to `-20..20` in the mock scenario store |
| 102-004 | 3 | Update the mock core-api adapter to compose pre-event and live scoring endpoints | Completed | Adapter now reads pre-event detail/feeds separately from live scores/results endpoints |
| 102-005 | 4 | Harden validation and contest-readiness assumptions around empty participant fields | Completed | Golf scenarios now fail validation when odds contestants are empty, and field snapshots resolve from odds-backed participants |
| 102-006 | 5 | Regenerate contracts and update tests/docs | Completed | Refreshed generated contracts, updated the mock-provider README, and verified unit/integration/functional coverage against local Postgres |
