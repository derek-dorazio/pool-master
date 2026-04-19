# Contest Event Feed Integration

## Purpose

Define the cross-module product design for the feature lane that connects:

- root-admin event operations
- sports-data provider ingestion
- commissioner contest creation/configuration/release
- team contest entry and selection

This feature treats contest setup and contest entry as downstream consumers of a
truthful sport-event and event-field model.

## Feature Summary

PoolMaster should support a real first-pass flow where:

1. a sport data provider exposes an event and its participant field
2. root admin synchronizes that event into PoolMaster
3. PoolMaster normalizes the event and participants
4. PoolMaster resolves event-level `releaseAt` and `fieldLocksAt` operational
   timestamps from global defaults
5. a commissioner creates a contest for that event
6. PoolMaster derives the contest-ready participant field from the event field
   plus contest configuration
7. once released, the contest uses its own frozen contest-field interpretation
8. teams create one or more entries and make their selections from that
   contest-ready field

## Big Themes

### 1. Event Truth Is Upstream `(Confirmed)`

Contests do not invent their own real-world event timing or participant field.
They depend on imported `SportEvent` and `SportEventParticipant` data.

### 2. Contest Field Is Derived, Not Blindly Duplicated `(Confirmed)`

The real-world event field should be modeled once at the event layer. Contest
selection should derive its own rules, ordering, tiering, prices, and category
groupings from that field plus contest configuration.

### 3. Admin Operations Bootstrap Trust `(Confirmed)`

Root-admin event operations are the first-pass operational control surface for:

- enabling provider use
- syncing a new event
- monitoring sync readiness
- retrying or refreshing a specific event

The long-term goal is more automation, but the first implementation should make
admin control explicit rather than hiding it.

### 4. The Mock Provider Is Real Product Infrastructure `(Confirmed)`

The mock sports data provider is not a test-only shortcut inside the app. It is
durable non-production feed infrastructure that allows the deployed product to
work end to end with named fake tournaments and participants before a real
provider is integrated.

## Major Modules

### Admin Event Operations

Goal:
- allow root admins to create, authorize, sync, and refresh event data needed
  for contest creation

Current match:
- provider admin and ingestion trigger surfaces exist
- event list ingestion exists

Current mismatch:
- there is no cohesive admin event lifecycle UX or explicit event readiness
  contract yet
- event operational timestamps such as `releaseAt` and `fieldLocksAt` are not
  yet modeled as the first-class admin control surface

### Mock Sports Data Provider

Goal:
- expose versioned provider-style APIs for event metadata, field data, odds,
  rankings, results, and updates

Current match:
- a mock feed provider package already exists with scenario-based endpoints

Current mismatch:
- it is still shaped around generic contest-feed snapshots rather than the full
  event/participant vocabulary we now need for event-first integration

### Commissioner Contest Setup And Release

Goal:
- let commissioners create contests for imported events by choosing from seeded
  default templates, optionally entering advanced configuration, and making
  contests immediately entry-ready when created

Current match:
- event-anchored contest creation and golf-first configuration are real

Current mismatch:
- contest release semantics and contest-field readiness are still implicit
- contest field derivation is mostly internal runtime behavior, not a clean
  product contract
- released-contest frozen field behavior is not yet explicit in the product or
  technical design
- first-pass seeded contest-config templates are not yet modeled as a
  first-class persisted concept

### Team Entry And Selection

Goal:
- let teams create multiple named entries and make selections from the
  contest-ready field while the contest is open

Current match:
- team-scoped multi-entry creation and rename behavior now exist

Current mismatch:
- entry selection is still coupled to draft-room/runtime contracts rather than
  a first-class contest-field flow designed from this module set

## Product Direction For First Pass

- first implemented sport family remains `GOLF`
- first implemented event family remains single-event tournament play
- first mock-provider depth should support named golf tournaments such as
  Masters-style majors
- contest creation should be template-first:
  - seeded templates
  - smart defaults
  - optional advanced overrides
- event creation/loading, contest configuration, contest release, and team entry
  should be designed together as one chain
- later sports should reuse the same event -> field -> contest field -> entry
  pattern even if the scoring and selection rules differ

## Recommended Deliverables For This Lane

- refined product requirements for the four major modules
- a technical spec covering:
  - domain ownership
  - event readiness
  - contest field derivation
  - route/API surface
  - end-to-end flows
- Beads-tracked refinement questions with stable IDs
- later parallel implementation slices once dependencies are clear
