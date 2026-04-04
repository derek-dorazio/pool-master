# Mock Contest Feed Provider

> **Planning Note (2026-04-04):** Re-analyze the current MVP scope, provider port/adapter contracts, and QA deployment boundaries before implementing this service. Do not reuse this plan for production or staging concerns, and do not introduce fallback behavior into the core app if the feed service is unavailable.

## Purpose

Create a non-production-only `mock-contest-feed-provider` service that simulates third-party odds, rankings, and results feeds for contests and contestants.

This service exists so we can:

- test ingestion and normalization without relying on external third parties
- drive deterministic tier/price derivation scenarios
- exercise results/standings/scoring flows with repeatable data
- keep the product code pointed at real provider ports/adapters while swapping only the provider implementation in QA and local test runs

## Scope

This plan covers the mock feed service itself plus the test-facing contracts it needs.

In scope:

- provider naming and domain alignment
- provider port/adapter fit
- QA/local-only deployment model
- OpenAPI and generated client output for the mock provider
- JSON scenario-file format and initial scenario data
- test-suite ownership and future update rules

Out of scope:

- production or staging deployment
- application fallback from real providers to the mock provider
- general contest UI changes unrelated to ingestion/provider testing
- replacing real ingestion provider logic in the main app

## Architecture Fit

The mock service should fit the existing port/adapter model instead of bypassing it.

- The app should keep talking to the same provider interface it uses for real odds/rankings/results sources.
- The mock provider should be selected by environment/config only in local and QA contexts.
- Production must continue to use real providers only.
- The mock provider should expose the same route semantics and shape as the real provider adapters expect, so ingest, tier, price, and results code can run unchanged.

Recommended domain naming:

- service name: `mock-contest-feed-provider`
- provider id: `mock-contest-feed`
- scenario folder: `contest-feed-scenarios`
- file naming should reflect contest/feed terminology, not generic test terminology

## Scenario Model

The service should use local JSON scenario files as its source of truth.

Scenario files should support:

- sport
- provider identifier
- event metadata
- contestant list
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

This service should be deployable only in:

- local development
- QA

It must not be deployed to:

- production
- staging, unless a future plan explicitly adds staging as a controlled test environment

The product must not depend on this service being available.

## Test Ownership

This service should own one dedicated test lane first, with future expansion only after the initial suite is stable.

Primary test goals:

- provider contract validation
- ingestion normalization
- odds/ranking/result mapping
- tier and price derivation from feed data
- scoring/standings updates from final results

Future test owners should update the scenario files rather than inventing ad hoc fixtures inside application tests.

## Update Rules For Future Agents

- Re-analyze the current MVP and provider contracts before adding scenarios.
- Keep JSON scenarios small and deterministic.
- Do not add production fallback code to support missing scenario data.
- Do not let the app silently fall back to the mock provider when real providers fail.
- Update this plan when the scenario format, provider contract, or deployment boundary changes.
- Keep the service strictly non-production-only unless the plan is explicitly re-opened.

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| MCFP-001 | Naming | Finalize the domain-accurate service name, provider id, and scenario directory naming | Not Started | Use contest/feed terminology so the service is clearly a mock third-party feed source for contests and contestants |
| MCFP-002 | Architecture | Define the provider port/adapter contract that the mock service must implement | Not Started | Keep it interchangeable with real feed providers without changing app code paths |
| MCFP-003 | Deployment | Define QA/local-only runtime and make production/staging deployment explicitly unsupported | Not Started | This service is test infrastructure, not a product fallback |
| MCFP-004 | OpenAPI | Generate and validate OpenAPI/client output for the mock service | Not Started | The app and test suites should consume generated types/clients, not handwritten request shapes |
| MCFP-005 | Scenarios | Design the JSON scenario-file format and baseline fixtures | Not Started | Include at least golf, tennis, team-tournament, and one correction/tie edge case |
| MCFP-006 | Ingestion Tests | Build a dedicated ingestion test suite that exercises the mock provider end to end | Not Started | Use the mock service only for the ingestion contract test lane |
| MCFP-007 | Tiering / Pricing | Verify odds, rankings, and seed data drive tier and price derivation deterministically | Not Started | The mock feed should make tier and price derivation repeatable for tournament contests |
| MCFP-008 | Results / Scoring | Verify final results and live updates propagate into standings and scoring flows | Not Started | Cover ties, withdrawals, and corrections in the scenario set |
| MCFP-009 | Maintenance | Define update rules for adding new scenarios and for changing existing ones | Not Started | Scenario updates should be reviewed as test-contract changes, not hidden product behavior |

## Acceptance Criteria

- The service name clearly communicates that it mocks contest feeds, not product behavior.
- The service is usable locally and in QA only.
- The app continues to use the normal provider port/adapter model.
- The product does not rely on this service for production operation.
- JSON scenario files are deterministic and easy to extend.
- At least one ingestion test suite runs fully against the mock service.
- Tiering, pricing, and results flows can be exercised without external third parties.
- Future agents have a clear rule set for when and how to add scenarios.

