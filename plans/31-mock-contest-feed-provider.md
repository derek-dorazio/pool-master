# Mock Sports Data Provider

## Purpose

Track execution for the non-production mock sports data provider lane.

## Authority

This file is execution context only.

Current product and technical source of truth lives in:

- [requirements/product-requirements/features/contest-event-feed-integration/overview.md](/Users/DDorazio/development/Github-Personal/pool-master/requirements/product-requirements/features/contest-event-feed-integration/overview.md)
- [requirements/product-requirements/features/contest-event-feed-integration/use-cases.md](/Users/DDorazio/development/Github-Personal/pool-master/requirements/product-requirements/features/contest-event-feed-integration/use-cases.md)
- [requirements/product-requirements/features/contest-event-feed-integration/business-rules.md](/Users/DDorazio/development/Github-Personal/pool-master/requirements/product-requirements/features/contest-event-feed-integration/business-rules.md)
- [tech-specs/features/contest-event-feed-integration/flows.md](/Users/DDorazio/development/Github-Personal/pool-master/tech-specs/features/contest-event-feed-integration/flows.md)

Do not use older plan prose to reopen product questions. Use requirements for
product truth, tech specs for implementation truth, and Beads for live status.

## Execution Constraints

- QA only
- no production fallback
- local JSON scenario files as source of truth
- no mock app seed data replacing provider scenarios

## Action Plan

| ID | Area | Task | Status | Notes |
|---|---|---|---|---|
| MCFP-001 | Naming | Finalize the domain-accurate service name, provider id, and scenario directory naming | Done | `mock-contest-feed-provider`, `mock-contest-feed`, and `contest-feed-scenarios` are now implemented in the standalone package |
| MCFP-002 | Architecture | Define the provider port/adapter contract that the mock service must implement | Done | Standalone Fastify routes now expose the feed contract surface locally without touching the core app wiring |
| MCFP-003 | Deployment | Define supported deployment boundaries for the mock sports data provider | Done | QA deployment, image publish, and service wiring are now implemented; production fallback remains explicitly disallowed |
| MCFP-004 | OpenAPI | Generate and validate OpenAPI/client output for the mock service | Done | Package-local OpenAPI export and generated client output now exist under `packages/mock-contest-feed-provider/generated/` |
| MCFP-005 | Scenarios | Design the JSON scenario-file format and baseline fixtures | Done | Baseline scenarios now live under `contest-feed-scenarios/`; golf now uses a season-backbone catalog direction instead of a single isolated event |
| MCFP-006 | Ingestion Tests | Build a dedicated ingestion test suite that exercises the mock provider end to end | Done | `tests/integration/core-api/mock-contest-feed-provider.integration.ts` now verifies provider endpoints through adapter and persistence |
| MCFP-007 | Tiering / Pricing | Verify odds, rankings, and seed data drive PoolMaster tier and valuation derivation deterministically | In Progress | Managed contest creation now derives deterministic tier membership/order from imported odds and ranking source data; future budget-style contests should derive prices inside PoolMaster from those valuation inputs rather than expect feed-provider budget data |
| MCFP-008 | Results / Scoring | Verify final results and live updates propagate into standings and scoring flows | In Progress | Mock-provider live scores/results ingestion is covered, but deeper standings/correction propagation coverage should still be expanded for later hardening |
| MCFP-009 | Maintenance | Define update rules for adding new scenarios and for changing existing ones | Done | Scenario updates are explicitly treated as contract changes, not app seed data |
| MCFP-010 | Seed Separation | Remove the need for broad QA fixture data in application seed flows and document the new boundary | Done | QA/manual test fixtures belong in mock feed scenarios, not app seed scripts |
| MCFP-011 | Golf Schedule Sourcing | Source the 2026 golf event schedule from real-world references and translate it into deterministic mock-provider event scenarios | Done | The `golf-major-2026` scenario now encodes a season-level 2026 golf backbone while retaining its stable scenario id |
| MCFP-012 | Golf Field Synthesis | Create believable deterministic upcoming-event fields, rankings, and odds from completed tournaments and stable historical/reference signals | Done | The golf catalog now carries deeper field variation, alternate/withdrawal churn, richer pre-lock odds/ranking refreshes, and multi-stage live/correction updates across the 2026 season backbone; future slices can still deepen event count and sport coverage beyond golf |
