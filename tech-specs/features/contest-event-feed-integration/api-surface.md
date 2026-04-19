# Contest Event Feed Integration API Surface

## Purpose

Describe the target contract surface for the four-module integration lane and
compare it with the current route surface.

## Current Surface Snapshot

### Already Present

- provider admin routes for provider config/health/re-ingest
- ingestion trigger routes
- event list route
- participant catalog routes
- commissioner contest-management routes
- contest entry routes
- draft/selection routes
- mock contest-feed-provider routes
- template-listing and template-based contest creation support

### Missing Or Implicit

- thin root-admin event operations workflow routes focused on exceptional
  provider/sync issues
- explicit event readiness / contest-eligibility contract
- explicit contest-field projection contract
- automated scoring/result propagation contract surfaces
- explicit leaderboard/history read contracts

## Recommended First-Pass Contract Areas

### 1. Root Admin Event Operations

Recommended operations:
- list provider-discovered/synced events for a sport
- sync/import a specific provider event
- refresh a synced event
- inspect event readiness and last sync outcome
- list recent sync runs with datetime and status

Notes:
- this should stay operational and exceptional rather than becoming a daily
  admin workflow
- this does not require broad member-facing event discovery
- sync-run records may use a simple JSON payload field in first pass so the
  operational surface can ship without over-modeling provider-specific details

### 2. Event Readiness Contract

Recommended response concepts:
- event summary
- `releaseAt`
- `fieldLocksAt`
- readiness status
- readiness reasons / missing prerequisites
- contest-eligible boolean

Implementation recommendation:
- keep timing defaults in a persisted seeded timing-policy source
- resolve those rules into concrete timestamps on each event
- expose the resolved timestamps in normal event/admin read models

### 3. Commissioner Contest Setup And Contest Creation

Recommended additions or refinements:
- current contest-management create/update remains the base
- add a contest-field preview/read model for pre-release review
- add or clarify the released contest frozen-field behavior in the create
  contract
- keep advanced field metadata global to the configuration/template definition
  rather than returning it as contest-instance state

Recommended create-contract shape:
- `name`
- `sportEventId`
- `contestType`
- `templateId`
- `configurationOverrides?`

Recommended create behavior:
- load selected template
- merge allowed overrides
- persist the resolved config instance
- persist `templateId` and `templateVersion` on the contest configuration
- build the frozen released-contest field projection as part of contest create

### 4. Team Entry And Selection

Recommended additions or refinements:
- keep team-context `Create entry`
- expose contest-field data in the entry-edit flow instead of relying only on
  generic draft-room state
- expose saved tier selections and tiebreaker input as entry-owned state

Implementation recommendation:
- released contest entry/edit flows should read the frozen contest-specific
  projection, not live event valuations/orderings
- commissioner administrative help flows should reuse the same team/entry tools
  rather than requiring a parallel contest-ops surface
- tiered golf first pass should support:
  - one selection per required tier/group
  - participant ordering by contest rank derived from tournament-winning odds
  - supporting display of world rank
  - winner-score tiebreaker input
  - post-lock read-only entry detail

Recommended read/write contract areas:
- `GET contest entry editor/detail`
  - contest metadata
  - lock state
  - frozen selection groups/tiers
  - current selected participant per group
  - tiebreaker value
- `PUT/PATCH contest entry selections`
  - selected participant ids keyed by group/tier
  - tiebreaker input

### 5. Leaderboard And History

Recommended additions:
- `GET contest leaderboard`
  - concise ordering for entries/teams and total score
  - optional expanded participant detail payload
  - final/live status metadata
- `GET contest entry detail`
  - team-scoped/post-lock standings view of a single entry
- `GET league completed contest history`
  - completed contests scoped to a league
  - filter/group fields for sport and contest type

Implementation recommendation:
- keep the leaderboard as the main live-event read model
- support detail expansion without changing base ordering
- keep first-pass history contest-centric rather than aggregate-stat-centric
- first pass may compute these views without separate materialized persisted
  copies; optimization/persistence can come later as a follow-on enhancement

### 6. Mock Provider

Recommended evolution areas:
- support event-first vocabulary explicitly
- keep versioned endpoints
- continue exposing event metadata, field data, rankings, odds, results, and
  updates without requiring a database

## Current Match / Mismatch

Matches:
- enough route surface exists to support the current golf-first MVP path

Mismatches:
- event list is summary-only and not an admin workflow
- participant routes are catalog-centric, not contest-field-centric
- contest-field derivation is still mostly implicit in draft routes
- released-contest field freeze semantics are not yet exposed as a contract
- current design direction no longer needs a separate commissioner release
  action in the normal flow
- advanced schema metadata source is intentionally global rather than
  contest-specific, but the precise read surface still needs to be clarified
- leaderboard/history read models are not yet explicit contracts
- sync-run visibility is not yet explicit as a lightweight operational contract
- mock provider is usable but still shaped as a generic contest-feed simulator
