## Purpose

Define the contest lifecycle and the downstream scoring/update behavior that the
product actually needs before building deeper contest flows.

## Scope

- pre-live contest lifecycle
- lock/live/completed lifecycle transitions
- entry update and standings propagation

## Starter User Cases

### CL-001: Commissioner sees contest move through truthful lifecycle states

**Actor:** Commissioner

**Preconditions**
- Contest exists

**Flow**
1. Commissioner views a contest before it starts
2. Contest transitions through its lifecycle according to approved rules
3. Commissioner sees the correct state and allowed actions for that phase

**Expected outcomes**
- Contest lifecycle is explicit and understandable
- Allowed edits/actions match the lifecycle phase

### CL-002: Member sees their entry and standings update as contest data changes

**Actor:** League member

**Preconditions**
- Member has an entry in the contest
- Underlying sporting data changes

**Flow**
1. Member views the contest
2. New event/participant data is processed
3. Entry scores and standings update

**Expected outcomes**
- The product has a clear source of truth for score propagation
- Entry and standings reads remain aligned with contest lifecycle

## Required Model Review Before Implementation

Before implementation, perform a dedicated review of:

- `Contest`
- `ContestEntry`
- standings and score-summary models
- contest status and derived scoring state
- any contest/admin DTOs still carrying deferred catalog values

The review must explicitly inspect:

- whether lifecycle/status fields are truthful active runtime fields or mixed
  with deferred catalogs
- whether score/standing fields are canonical persisted state or derived reads
- any JSON or broad-string fields in lifecycle, scoring, and standings models
- whether root-admin contest remnants still exist and should be removed first

## Design Direction

- Keep lifecycle states explicit and product-driven
- Avoid generic scoring abstractions until the approved feature flow demands
  them
- Treat event-driven score propagation as a designed system, not incidental
  side effects scattered across routes
