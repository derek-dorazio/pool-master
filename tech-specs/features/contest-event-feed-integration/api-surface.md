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

### Missing Or Implicit

- explicit root-admin event operations workflow routes
- explicit event readiness / contest-eligibility contract
- explicit contest-field projection contract
- release-oriented contest operation distinct from generic editing

## Recommended First-Pass Contract Areas

### 1. Root Admin Event Operations

Recommended operations:
- list provider-discovered/synced events for a sport
- sync/import a specific provider event
- refresh a synced event
- inspect event readiness and last sync outcome

Notes:
- this does not require broad member-facing event discovery

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

### 3. Commissioner Contest Setup And Release

Recommended additions or refinements:
- current contest-management create/update remains the base
- add template-selection support to contest creation inputs/read models
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

Implementation recommendation:
- released contest entry/edit flows should read the frozen contest-specific
  projection, not live event valuations/orderings

### 5. Mock Provider

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
- no first-pass read surface exists for seeded contest templates even though the
  desired create flow is template-first
- advanced schema metadata source is still not explicit in the contract even
  though it is now confirmed to be global rather than contest-specific
- mock provider is usable but still shaped as a generic contest-feed simulator
