# Contest Event Feed Integration

## Purpose

Define the cross-module product design for the feature lane that connects:

- root-admin event operations
- sports-data provider ingestion
- commissioner contest creation/configuration
- team contest entry and selection
- automatic scoring and results propagation

This feature treats contest setup and contest entry as downstream consumers of a
truthful sport-event and event-field model.

This feature should preserve a frictionless operating model:

- normal event and participant lifecycle is automated
- root-admin involvement is exceptional and operational
- commissioner setup should be fast and template-driven
- commissioners behave like members for ongoing contest participation
- live scoring updates are backend automation, not a manual workflow

This lane should also deliver a full first-pass lifecycle, not just contest
creation:

- entry creation
- live scoring
- contest completion
- winners
- completed contest history

## Feature Summary

PoolMaster should support a real first-pass flow where:

1. a sport data provider exposes an event and its participant field
2. PoolMaster imports that event and participant field from the provider
3. PoolMaster normalizes the event and participants
4. PoolMaster resolves event-level `releaseAt` and `fieldLocksAt` operational
   timestamps from global defaults
5. a commissioner creates a contest for that event
6. PoolMaster derives the contest-ready participant field from the event field
   plus contest configuration
7. contest creation immediately makes the contest live for entries and freezes
   its own contest-field interpretation
8. teams create one or more entries and make their selections from that
   contest-ready field
9. backend ingestion/scoring jobs automatically update participant stats,
   entry scores, and leaderboard order as provider data changes

## Big Themes

### 1. Event Truth Is Upstream `(Confirmed)`

Contests do not invent their own real-world event timing or participant field.
They depend on imported `SportEvent` and `SportEventParticipant` data.

### 2. Contest Field Is Derived, Not Blindly Duplicated `(Confirmed)`

The real-world event field should be modeled once at the event layer. Contest
selection should derive its own rules, ordering, tiering, prices, and category
groupings from that field plus contest configuration.

### 3. Admin Operations Stay Light-Touch `(Confirmed)`

Root-admin event operations are a light-touch operational control surface for:

- enabling provider use
- monitoring imports and provider health
- retrying or refreshing a specific event if needed
- advanced override of event-level `releaseAt` and `fieldLocksAt` only in rare
  cases

The normal flow is automated. Events are provider-imported from real-world
schedules, and default relative timing rules resolve into event-specific
datetimes without requiring routine admin action.

### 3A. Commissioner Operations Stay Light-Touch `(Confirmed)`

Commissioners should not accumulate extra operational steps after contest
creation. They create contests quickly, handle occasional league
administration, and otherwise use the same team and entry tools as members.

### 4. The Mock Provider Is Real Product Infrastructure `(Confirmed)`

The mock sports data provider is not a test-only shortcut inside the app. It is
durable non-production feed infrastructure that allows the deployed product to
work end to end with named fake tournaments and participants before a real
provider is integrated.

## Major Modules

### Admin Event Operations

Goal:
- keep imported events operationally healthy with minimal routine admin effort

Current match:
- provider admin and ingestion trigger surfaces exist
- event list ingestion exists
- event operational timestamps such as `releaseAt` and `fieldLocksAt` now
  exist in the model and timing foundation

Current mismatch:
- there is no cohesive admin event lifecycle UX or explicit event readiness
  contract yet

### Mock Sports Data Provider

Goal:
- expose versioned provider-style APIs for event metadata, field data, odds,
  rankings, results, and updates

Current match:
- a mock feed provider package already exists with scenario-based endpoints

Current mismatch:
- it is still shaped around generic contest-feed snapshots rather than the full
  event/participant vocabulary we now need for event-first integration

### Commissioner Contest Setup

Goal:
- let commissioners create contests for imported events by choosing from seeded
  default templates, optionally entering advanced configuration, and making
  contests immediately entry-ready when created

Current match:
- event-anchored contest creation and golf-first configuration are real
- seeded contest-config templates are now modeled as a first-class persisted
  concept
- template-first contest creation flow is now implemented

Current mismatch:
- contest-field readiness and frozen-field semantics are still implicit
- contest field derivation is mostly internal runtime behavior, not a clean
  product contract
- released-contest frozen field behavior is not yet explicit in the product or
  technical design

### Team Entry And Selection

Goal:
- let teams create multiple named entries and make selections from the
  contest-ready field while the contest is open

Current match:
- team-scoped multi-entry creation and rename behavior now exist

Current mismatch:
- entry selection is still coupled to draft-room/runtime contracts rather than
  a first-class contest-field flow designed from this module set
- commissioner-as-member behavior and league-scoped administrative use of the
  same tools should be made more explicit in the product flow

### Automatic Scoring And Results Propagation

Goal:
- let backend jobs poll provider updates, refresh event-participant stats,
  recompute entry scores, and update leaderboard order automatically

Current match:
- ingestion/provider foundations already exist
- scoring/runtime modules already exist in partial form

Current mismatch:
- the automatic scoring pipeline is not yet documented as a first-class module
- provider polling cadence, update handling, and scoring propagation need a
  cleaner end-to-end contract
- there is no identified commissioner/member/admin operational role in normal
  scoring flow beyond monitoring and rare reruns for broken feeds

## Product Direction For First Pass

- first implemented sport family remains `GOLF`
- first implemented event family remains single-event tournament play
- first mock-provider depth should support named golf tournaments such as
  Masters-style majors
- contest creation should be template-first:
  - seeded templates
  - smart defaults
  - optional advanced overrides
- first entry-selection implementation should target tiered golf contests
- event creation/loading, contest configuration, contest creation, team entry,
  live scoring, and completion/history should be designed together as one chain
- leaderboards are a universal contest concept across sports even though detail
  columns will vary by sport
- first-pass history should focus on completed contests by sport and contest
  type within the league
- later sports should reuse the same event -> field -> contest field -> entry
  -> scoring -> history pattern even if the scoring and selection rules differ

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
