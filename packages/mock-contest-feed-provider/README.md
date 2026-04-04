# Mock Contest Feed Provider

`mock-contest-feed-provider` is a non-production-only Fastify service that simulates third-party contest feed data for odds, rankings, and results.

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
- `GET /v1/scenarios/:scenarioId/events/:eventId/odds`
- `GET /v1/scenarios/:scenarioId/events/:eventId/rankings`
- `GET /v1/scenarios/:scenarioId/events/:eventId/results`
- `GET /v1/scenarios/:scenarioId/events/:eventId/updates`
- Swagger UI at `/docs`

## Run Locally

```bash
npm run dev --workspace @poolmaster/mock-contest-feed-provider
```

The service listens on `PORT=3105` by default.

## OpenAPI And Client Generation

The package includes its own local export and client-generation setup:

- `npm run generate:openapi --workspace @poolmaster/mock-contest-feed-provider`
- `npm run generate:client --workspace @poolmaster/mock-contest-feed-provider`
- `npm run generate --workspace @poolmaster/mock-contest-feed-provider`

The OpenAPI export writes to `packages/mock-contest-feed-provider/generated/openapi.json`, and the generated client output lives under `packages/mock-contest-feed-provider/generated/hey-api/`.

## Scenario Files

Each JSON file in [`contest-feed-scenarios/`](./contest-feed-scenarios) describes one named contest-feed scenario.

The current baseline scenarios cover:

- golf
- tennis
- NCAA-style team tournament
- one correction/tie edge case

These files are intended to grow as future ingestion and manual-testing cases are added.
