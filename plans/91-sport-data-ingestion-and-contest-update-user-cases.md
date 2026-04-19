## Purpose

Define the ingestion and event-driven update lane that supports contests,
participants, and entry updates.

## Scope

- importing and refreshing sporting event data
- participant and event updates
- downstream contest and entry recalculation triggers

## Starter User Cases

### DI-001: Platform ingests sporting event and participant updates

**Actor:** System / platform operations

**Preconditions**
- Provider configuration exists
- Polling or ingestion trigger runs

**Flow**
1. System receives new provider data
2. System normalizes and persists the event and participant updates
3. System records ingestion progress and failures truthfully

**Expected outcomes**
- Provider data is stored in a way that matches the approved ingestion model
- External payload snapshots stay flexible only where they should

### DI-002: Event and participant changes drive contest-entry updates

**Actor:** System / league member as observer

**Preconditions**
- A contest depends on the updated event or participant data

**Flow**
1. Ingestion updates an event or participant
2. Downstream logic identifies affected contests and entries
3. System updates contest and entry read models according to contest state

**Expected outcomes**
- Event-driven updates are explicit and traceable
- Unreleased contests may continue to reflect newer eligible event data
- Released contests preserve their frozen contest-field derivations while still
  surfacing informational participant status changes where appropriate

## Required Model Review Before Implementation

Before implementation, perform a dedicated review of:

- `SportEvent`
- `SportEventParticipant`
- `Participant`
- participant season records
- ingestion job and source payload models
- any event-to-contest linking models

The review must explicitly inspect:

- which JSON fields are honest provider payload snapshots versus normalization
  debt
- which broad-string fields should become enums
- whether ingestion status and source-state fields are truthful and minimal
- whether any event/participant metadata has been over-modeled for sports the
  current product does not support yet

## Design Direction

- Preserve JSON only where the payload is truly provider-defined or sport-
  specific
- Strongly type reviewed closed sets
- Keep event-driven update paths explicit so future contest work does not hide
  lifecycle logic in ad hoc service code
- Distinguish clearly between:
  - upstream event-field truth that may continue changing
  - frozen released-contest field projections that should not drift after
    contest creation
