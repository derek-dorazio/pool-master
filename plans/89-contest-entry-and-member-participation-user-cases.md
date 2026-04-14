## Purpose

Define the first-pass member contest-entry experience and the modeling review
required before building it.

## Scope

- members discovering an eligible contest within a league
- members creating an entry for a contest
- member entry ownership and editability rules

## Starter User Cases

### CE-001: Member creates an entry for an active contest

**Actor:** League member

**Preconditions**
- User is authenticated
- User belongs to the league
- Contest is in a state that allows entry creation

**Flow**
1. Member opens the contest
2. Member chooses to create an entry
3. Member completes the required entry setup
4. System validates the entry
5. System creates the entry and returns the member to contest context

**Expected outcomes**
- Entry belongs to the member and contest
- Entry surface exposes only the first-pass required concepts

### CE-002: Member reviews their own contest entries

**Actor:** League member

**Preconditions**
- User has at least one entry in the contest

**Flow**
1. Member opens the contest detail
2. Member views their entries
3. Member sees whether the entry is still editable or locked

**Expected outcomes**
- Entry ownership and visibility are explicit
- Lock/edit rules follow the contest lifecycle truthfully

## Required Model Review Before Implementation

Before implementation, perform a dedicated review of:

- `ContestEntry`
- entry-related read models
- any entry status, editability, lock, or ownership fields
- related DTOs and generated contracts

The review must explicitly inspect:

- JSON fields that may be carrying speculative entry structure
- string fields that should become enums
- fields that are placeholders for future contest modes rather than current
  member entry behavior
- whether entry-level lifecycle state belongs on the core entry model or a
  derived read model

## Design Direction

- Start with one truthful entry flow, not a generalized contest-engine surface
- Model entry ownership, lockability, and member visibility explicitly
- Remove placeholder entry fields before implementation if they do not support
  the approved first-pass member flow
