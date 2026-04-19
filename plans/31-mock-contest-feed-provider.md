# Mock Sports Data Provider

> **Planning Note (2026-04-04):** Re-analyze the current MVP scope, provider port/adapter contracts, and QA deployment boundaries before implementing this service. Do not reuse this plan for production or staging concerns, and do not introduce fallback behavior into the core app if the feed service is unavailable.

## Purpose

Create a seeded `mock-contest-feed-provider` service that simulates third-party
sporting-event, participant-field, odds, rankings, and results feeds.

This service exists so we can:

- test ingestion and normalization without relying on external third parties
- drive deterministic tier/price derivation scenarios
- exercise results/standings/scoring flows with repeatable data
- keep the product code pointed at real provider ports/adapters while swapping
  only the provider implementation in supported non-production environments
- hold durable fake but stable event/participant data so the deployed product
  can function end to end before real provider integration is complete

## Scope

This plan covers the mock provider service itself plus the contracts it needs.

In scope:

- provider naming and domain alignment
- provider port/adapter fit
- supported deployment model
- OpenAPI and generated client output for the mock provider
- JSON scenario-file format and initial scenario data
- test-suite ownership and future update rules

Out of scope:

- application fallback from real providers to the mock provider
- general contest UI changes unrelated to ingestion/provider testing
- replacing real ingestion provider logic in the main app

## Seed Boundary

This service is also the boundary that keeps QA test fixtures out of application seeding.

Seed data for the app should contain only:

- production-required bootstrap records
- required default configurations
- necessary operator/admin access records

Seed data for the app should not contain:

- fake QA contests created directly in the app DB
- fake participant pools created directly in the app DB
- fake odds or rankings
- fake result histories
- broad manual-testing fixtures

Those non-production testing datasets should live in `mock-contest-feed-provider` scenario files and be served through the mock feed API instead of being inserted through `prisma/seed.ts`.

## Architecture Fit

The mock service should fit the existing port/adapter model instead of bypassing it.

- The app should keep talking to the same provider interface it uses for real odds/rankings/results sources.
- The mock provider should be selected by environment/config in supported
  non-production and bootstrap contexts.
- Production must continue to use real providers only.
- The mock provider should expose the same route semantics and shape as the real provider adapters expect, so ingest, tier, price, and results code can run unchanged.

Recommended domain naming:

- service name: `mock-contest-feed-provider`
- provider id: `mock-contest-feed`
- scenario folder: `contest-feed-scenarios`
- file naming should reflect event/participant/feed terminology, not generic
  test terminology

## Scenario Model

The service should use local JSON scenario files as its source of truth.

Scenario files should support:

- sport
- provider identifier
- event metadata
- participant field
- odds
- rankings
- seed values
- live score updates
- final results
- optional corrections or delayed updates

Suggested file shape:

```json
{
  "scenarioId": "golf-major-2026",
  "sport": "GOLF",
  "provider": "mock-contest-feed",
  "events": [
    {
      "eventId": "event-1",
      "name": "Mock Major",
      "startsAt": "2026-04-10T15:00:00.000Z",
      "contestants": [
        {
          "contestantId": "player-1",
          "name": "Player One",
          "odds": 12.5,
          "ranking": 1,
          "seed": 1
        }
      ]
    }
  ]
}
```

The format should be stable enough to support:

- a few fixed baseline scenarios
- additional scenarios added as integration and smoke coverage grows
- deterministic updates without a database

## Initial Scenario Set

Start with a small but useful set of sport families:

- golf tournament scenario
- tennis tournament scenario
- NCAA-style team tournament scenario
- one team-slate scenario with live result updates
- one edge-case scenario for ties, withdrawals, or corrections

The initial data should be broad enough to exercise:

- odds-based tier assignment
- ranking-based pricing
- seed-based fallback ordering
- final result ingestion
- contest standing updates after results arrive

## Deployment Rules

This service should support:

- local development
- QA
- other explicitly approved non-production/bootstrap environments

It must not silently replace real providers in production operation.

Recommended runtime shape:

- local: run as a lightweight local service from scenario JSON files
- QA: deploy as a dedicated long-running ECS-backed HTTP service so CI smoke/E2E, ingestion tests, and manual testers can all hit the same deterministic feed catalog

Recommended QA role:

- the service should act as shared non-production feed infrastructure for QA
- it should replace the need to stuff broad fake contest data into application seed scripts
- it should be safe to expand with more scenario files over time without changing the core app seed contract

## Test Ownership

This service should own one dedicated test lane first, with future expansion only after the initial suite is stable.

Primary test goals:

- provider contract validation
- ingestion normalization
- odds/ranking/result mapping
- tier and price derivation from feed data
- scoring/standings updates from final results
- end-to-end product operation against stable fake events and participant fields
- manual QA support through stable, named scenarios that can be referenced in test instructions

Future test owners should update the scenario files rather than inventing ad hoc fixtures inside application tests.

## Update Rules For Future Agents

- Re-analyze the current MVP and provider contracts before adding scenarios.
- Keep JSON scenarios small and deterministic.
- Do not add production fallback code to support missing scenario data.
- Do not let the app silently fall back to the mock provider when real providers fail.
- Do not add broad QA/manual-test fixture data to `prisma/seed.ts`; add or update mock feed scenarios instead.
- Update this plan when the scenario format, provider contract, or deployment boundary changes.
- Keep the mock provider as explicit seeded infrastructure, not hidden fallback
  behavior.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| MCFP-001 | Naming | Finalize the domain-accurate service name, provider id, and scenario directory naming | Done | `mock-contest-feed-provider`, `mock-contest-feed`, and `contest-feed-scenarios` are now implemented in the standalone package |
| MCFP-002 | Architecture | Define the provider port/adapter contract that the mock service must implement | Done | Standalone Fastify routes now expose the feed contract surface locally without touching the core app wiring |
| MCFP-003 | Deployment | Define supported deployment boundaries for the mock sports data provider | In Progress | The package currently runs locally and remains non-production-oriented; later work should clarify which non-production/bootstrap environments may rely on it explicitly without introducing hidden fallback behavior. |
| MCFP-004 | OpenAPI | Generate and validate OpenAPI/client output for the mock service | Done | Package-local OpenAPI export and generated client output now exist under `packages/mock-contest-feed-provider/generated/` |
| MCFP-005 | Scenarios | Design the JSON scenario-file format and baseline fixtures | Done | Baseline golf, tennis, NCAA team, and tie/correction scenarios now live under `contest-feed-scenarios/` |
| MCFP-006 | Ingestion Tests | Build a dedicated ingestion test suite that exercises the mock provider end to end | Not Started | Use the mock service only for the ingestion contract test lane |
| MCFP-007 | Tiering / Pricing | Verify odds, rankings, and seed data drive tier and price derivation deterministically | Not Started | The mock feed should make tier and price derivation repeatable for tournament contests |
| MCFP-008 | Results / Scoring | Verify final results and live updates propagate into standings and scoring flows | Not Started | Cover ties, withdrawals, and corrections in the scenario set |
| MCFP-009 | Maintenance | Define update rules for adding new scenarios and for changing existing ones | Done | Scenario updates are now explicitly treated as test-contract changes, not app seed data |
| MCFP-010 | Seed Separation | Remove the need for broad QA fixture data in application seed flows and document the new boundary | Done | The seed boundary is now documented in `rules/testing-rules.md` and in this plan; QA/manual test fixtures belong in mock feed scenarios |

## Acceptance Criteria

- The service name clearly communicates that it mocks contest feeds, not product behavior.
- The service is usable locally and in QA only.
- QA can use it as shared feed infrastructure for automated and manual testing.
- The app continues to use the normal provider port/adapter model.
- The product does not rely on this service for production operation.
- JSON scenario files are deterministic and easy to extend.
- Application seed scripts no longer need broad fake QA contest data.
- At least one ingestion test suite runs fully against the mock service.
- Tiering, pricing, and results flows can be exercised without external third parties.
- Future agents have a clear rule set for when and how to add scenarios.
