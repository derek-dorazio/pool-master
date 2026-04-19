# Contest Event Feed Integration Domain Model

## Purpose

Describe the target ownership boundaries for the event/feed -> contest ->
entry chain and compare them with the current implementation.

## Core Concepts

### `SportEvent`

Role:
- canonical real-world event boundary

Owns:
- sport
- event identity
- real-world timing
- normalized event status

Current status:
- implemented

Notes:
- should remain the anchor for contest creation
- should gain or surface PoolMaster operational timestamps such as `releaseAt`
  and `fieldLocksAt`

### `ContestTimingPolicy` `(Proposed persisted seeded concept)`

Role:
- seeded rule source used to resolve default event-level `releaseAt` and
  `fieldLocksAt`

Owns:
- scope fields such as `sport`, `eventType`, and `contestType`
- default release rule expression
- default field lock rule expression

Current status:
- not first-class yet

Notes:
- recommended as a persisted seeded concept rather than a code-only registry so
  the defaults stay queryable and explainable
- `SportEvent.releaseAt` and `SportEvent.fieldLocksAt` remain the resolved
  operational truth

### `Participant`

Role:
- normalized sport-level participant identity

Owns:
- participant identity within a sport
- shared display metadata
- provider mappings / season history as needed

Current status:
- implemented

Notes:
- aligns with the requirement to avoid duplicate copies of the same golfer/team
  across events

### `SportEventParticipant`

Role:
- canonical event-field membership record

Owns:
- membership of a normalized participant in a specific event
- event-specific status and metadata

Current status:
- implemented and already used by draft/selection runtime

Notes:
- should remain the field identity used by contest selection and scoring

### `SportEventParticipantSourceData`

Role:
- provider payload and normalized event-participant result snapshots

Current status:
- implemented

Notes:
- should continue holding sport/provider-specific facts that do not yet justify
  a strongly typed first-pass shared model

### `SportEventParticipantValuation`

Role:
- derived ordering/tier/pricing inputs

Current status:
- implemented

Notes:
- currently already used by draft routes
- freeze semantics for contest release/lock still need definition

### `Contest`

Role:
- league-scoped contest tied to one `SportEvent`

Current status:
- implemented

Notes:
- should keep `sportEventId` as the authoritative event anchor

### `ContestConfiguration`

Role:
- contest mode and rule definition

Current status:
- implemented

Notes:
- typed golf-first config is in place
- some legacy mirrored fields still remain for compatibility/read paths
- should store template provenance on the contest instance:
  - `templateId`
  - `templateVersion`
- create flow should copy the selected template payload into the contest
  instance, then apply any allowed advanced overrides to that copied instance

### `ContestConfigTemplate` `(Proposed persisted concept)`

Role:
- reusable seeded template for a sport/event/contest-style configuration

Owns:
- scope fields:
  - `sport`
  - `eventType`
  - `contestType`
  - `configMode`
- stable identity:
  - `templateKey`
- display name
- description
- sort order
- default selection flag
- active flag
- typed config payload used to seed contest creation
- global template-selection metadata for the normal create flow
- schema-version compatibility marker

Current status:
- not first-class yet

Notes:
- first-pass lifecycle should be seed/migration managed only
- no first-pass template-management UI or API is required
- field-level advanced UI metadata should remain global and should not be copied
  into contest instances
- recommended persisted shape:
  - `id`
  - `sport`
  - `eventType`
  - `contestType`
  - `configMode`
  - `templateKey`
  - `name`
  - `description`
  - `sortOrder`
  - `isDefault`
  - `active`
  - `configJson`
  - `schemaVersion`
  - `createdAt`
  - `updatedAt`
- recommended constraints:
  - unique on `sport + eventType + contestType + configMode + templateKey`
  - at most one active default per `sport + eventType + contestType + configMode`

### `Contest Selection Field` `(Proposed derived concept)`

Role:
- contest-facing read/projection model that combines:
  - event-field membership
  - valuation metadata
  - contest configuration
  - contest-specific availability/freeze rules

Current status:
- partially implicit inside draft runtime

Notes:
- recommended as a read/projection concept first, not necessarily a new full
  persistence table

### `Released Contest Field Snapshot / Projection` `(Proposed derived concept)`

Role:
- preserve the frozen contest-specific interpretation of the field once a
  contest is released

Owns:
- contest-specific frozen derivations such as:
  - tiers
  - prices
  - ordering/rank used by the contest
  - category interpretation
  - selection-group structure
  - frozen participant eligibility / selectability

Current status:
- not explicit yet

Notes:
- recommended because released contests must not be invalidated by later
  provider/event updates
- this projection is contest-specific and should persist the frozen released
  field semantics, unlike the global UI/schema metadata
- recommended normalized shape:
  - `ContestSelectionGroup`
    - `id`
    - `contestId`
    - `groupKey`
    - `groupType`
    - `label`
    - `pickCount`
    - `sortOrder`
  - `ContestSelectionGroupParticipant`
    - `id`
    - `contestSelectionGroupId`
    - `contestId`
    - `sportEventParticipantId`
    - `participantId`
    - `sortOrder`
    - `price`
    - `tier`
    - `statusAtFreeze`
    - `metadataJson`
- a compact JSON snapshot may still be added later for audit/debug, but the
  primary runtime model should be normalized projection tables

### `ContestEntry`

Role:
- team-owned participation record for a contest

Current status:
- implemented

Notes:
- multi-entry support and rename-after-create exist
- selection/edit model still needs to be aligned with the contest selection
  field concept

## Recommended Ownership Boundaries

- `SportEvent` owns real-world event lifecycle
- `Participant` owns normalized participant identity
- `SportEventParticipant` owns event-field membership
- `ContestConfiguration` owns the contest rules
- derived contest-field behavior should be a projection built from the event
  field and contest config
- `ContestEntry` owns user/team participation and saved selections

## Current Match / Mismatch

Matches:
- event, participant, event participant, and valuation persistence already exist
- contests already point at `sportEventId`
- draft/selection runtime already consumes event participants

Mismatches:
- no explicit event-readiness concept
- no first-class contest-field projection contract
- no explicit released-contest frozen-field concept
- no first-class seeded contest-template concept
- some older language still implies contest-local participant pools
- contest configuration still mirrors some legacy fields that should narrow over
  time
