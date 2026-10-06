# Mock Contest Feed Provider

`mock-contest-feed-provider` is a non-production-only Fastify service that simulates third-party contest feed data for event schedules, field membership, odds, rankings, results, and staged updates.

The service now exposes the mock lifecycle more explicitly:

- pre-event catalog / odds feeds for schedule, field, rankings, and contest
  preparation
- live scoring feeds for in-progress score movement and final results

It is designed for:

- local development
- QA
- automated feed-ingestion tests
- manual testing against named scenarios

It does not use a database. Local JSON scenario files under [`contest-feed-scenarios/`](./contest-feed-scenarios) are the source of truth.

## What It Exposes

- `GET /health`
- `GET /v1/scenarios`
- `GET /v1/scenarios/:scenarioId`
- `GET /v1/scenarios/:scenarioId/events`
- `GET /v1/scenarios/:scenarioId/events/:eventId`
- `GET /v1/scenarios/:scenarioId/events/:eventId/detail`
- `GET /v1/scenarios/:scenarioId/events/:eventId/field`
- `GET /v1/scenarios/:scenarioId/events/:eventId/odds`
- `GET /v1/scenarios/:scenarioId/events/:eventId/rankings`
- `GET /v1/scenarios/:scenarioId/events/:eventId/results`
- `GET /v1/scenarios/:scenarioId/events/:eventId/updates`
- `GET /v1/pre-event/scenarios/:scenarioId/events/:eventId/detail`
- `GET /v1/pre-event/scenarios/:scenarioId/events/:eventId/field`
- `GET /v1/pre-event/scenarios/:scenarioId/events/:eventId/odds`
- `GET /v1/pre-event/scenarios/:scenarioId/events/:eventId/rankings`
- `GET /v1/live/scenarios/:scenarioId/events/:eventId/scores`
- `GET /v1/live/scenarios/:scenarioId/events/:eventId/results`
- `PUT /v1/scenarios/:scenarioId/events/:eventId/replay`
- `GET /v1/scenarios/:scenarioId/events/:eventId/replay`
- `DELETE /v1/scenarios/:scenarioId/events/:eventId/replay`
- Swagger UI at `/docs`

## Live Golf Replay

Without a `mockEventState` token, `/scores` normally returns the same snapshot on every
poll. A live replay makes it move, so a live contest's leaderboard can be tested:

```bash
curl -X PUT localhost:3105/v1/scenarios/golf-major-2026/events/golf-players-2026/replay \
  -H 'content-type: application/json' -d '{"minutesPerRound": 20}'
```

The body is optional: `startsAt` (default now), `minutesPerRound` (default 20) and
`minutesBetweenRounds` (default 0). While the replay runs, every `/scores` request for that
event without a `mockEventState` token is computed from the replay clock
(`src/golf-live-simulation.ts`):

- golfers tee off across the first third of each round and play holes at a steady pace, so
  `thru` and to-par change between polls; from round 3 the leaders tee off last
- each hole is a seeded draw that favours better-ranked (lower `seed`) golfers, so the same
  event and moment always give the same scores
- the top 65 and ties after round 2 make the cut; the rest get `MISSED_CUT`
- a few golfers withdraw mid-round (`DNF`)
- four rounds only, never past hole 18

In QA the mock is internal-only, so start a replay from PoolMaster instead: link the
tournament to a mock event, then press **Start live simulation** on its score-source card
(`startEventLiveSimulation`), and only then move the tournament to Live so the live-score sync
polls it. Moving it to Live first stores the mock's fixed scores before the replay takes over.
The card re-reads the replay's round every 30 seconds (`getEventLiveSimulation`).

Restarting a replay part-way through starts again from round 1, but PoolMaster keeps every
round it has already stored. Rounds the new replay has not reached yet stay at their old
values until the replay overwrites them, so a restarted event's leaderboard mixes the two runs.
For a clean run, use a fresh PoolMaster event, or delete its stored scores first.

`GET .../replay` reports the phase and current round; `DELETE .../replay` stops it. A
`mockEventState` token still pins its fixed state while a replay runs. Replays are held in
memory and do not survive a restart.

## Sandbox Golf Events

The `golf-sandbox` scenario lists no events, but answers any event id that starts with
`sandbox-` as a golf event with the shared 80-golfer field: detail, field, scores and
replay all work. Its schedule is a fixed placeholder and nothing about it is compared with
today, so a made-up PoolMaster tournament on any dates can have its own mock event.

In PoolMaster, press **Link to a new simulated event** on an unlinked tournament's
score-source card. That links it to `sandbox-<PoolMaster event id>`, which is unique per
tournament. Then load the participant field, set ranks and tiers, and start the live
simulation. Until a replay runs, a sandbox event's scores show nobody on the course.

## Run Locally

```bash
npm run dev --workspace @poolmaster/mock-contest-feed-provider
```

The service listens on `PORT=3105` by default.

To validate that all bundled scenario JSON files still satisfy the hardened
loader contract:

```bash
npm run validate:scenarios --workspace @poolmaster/mock-contest-feed-provider
```

## OpenAPI And Client Generation

The package includes its own local export and client-generation setup:

- `npm run generate:openapi --workspace @poolmaster/mock-contest-feed-provider`
- `npm run generate:client --workspace @poolmaster/mock-contest-feed-provider`
- `npm run generate --workspace @poolmaster/mock-contest-feed-provider`

The OpenAPI export writes to `packages/mock-contest-feed-provider/generated/openapi.json`, and the generated client output lives under `packages/mock-contest-feed-provider/generated/hey-api/`.

## Scenario Files

Each JSON file in [`contest-feed-scenarios/`](./contest-feed-scenarios)
describes one named scenario with:

- season metadata
- one or more events
- event schedule and release/field lock timing
- event metadata and venue details
- a baseline field snapshot
- baseline odds/rankings/results snapshots
- ordered update records for field changes, live updates, and corrections

The current baseline scenarios cover:

- golf
- tennis
- NCAA-style team tournament
- one correction/tie edge case

These files are intended to grow as future ingestion and manual-testing cases are added.

## Scenario Contract Notes

The scenario model is intentionally event-first and database-free:

- `season` anchors a reusable schedule context for the scenario.
- `event.field` is the baseline pre-event contestant catalog.
- `event.feeds` contains baseline feed deltas for `odds`, `rankings`, and
  `results`.
- `event.updates` contains staged `field`, `odds`, `rankings`, or `results`
  deltas with an explicit `updateType` such as `live` or `correction`.

For golf scenarios:

- the pre-event participant field is derived from the event odds contestants
- a golf event must include odds contestants or scenario validation fails
- the bundled 2026 golf season uses a stable 80-player field so pick-6 tiered
  contests can be exercised against realistic field sizes
- the generated `golf-relative-today` scenario includes a manual lifecycle
  event plus two rolling Thursday-Sunday QA tournaments, anchored to the
  provider clock, so root-admin sync testing always has future golf events for
  commissioner contest creation
- golf odds are generated deterministically per event from the stable player
  pool, so each tournament has different outright pricing while preserving
  repeatability
- live score snapshots are generated deterministically from event seed, tick,
  participant id, and participant odds, with scores clamped to `-20..20`

The loader validates:

- required event-first shape
- ISO datetime fields
- unique scenario IDs, event IDs, contestant IDs, and update IDs
- feed/update references to known contestants unless a new contestant is
  explicitly introduced by name

That keeps scenario files deterministic and suitable for QA and ingestion
verification without introducing a database.
