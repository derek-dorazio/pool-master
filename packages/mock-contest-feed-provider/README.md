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
- Swagger UI at `/docs`

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
