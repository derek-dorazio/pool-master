## Purpose

Define the product and modeling expectations for commissioners creating and
configuring contests inside a league.

This plan is intentionally a starter plan. It exists to capture the feature
lane and to require a fresh model review before implementation begins.

## Scope

- commissioner creates a contest for a league
- commissioner configures the contest using truthful first-pass settings
- contest configuration is reviewed as a real product/domain model rather than
  carried forward from legacy generic contest-engine assumptions

## Starter User Cases

### CC-001: Commissioner creates a contest for a league

**Actor:** Commissioner

**Preconditions**
- User is authenticated
- User is a commissioner for the league

**Flow**
1. Commissioner opens the league context
2. Commissioner chooses to create a contest
3. Commissioner enters the required contest details
4. System validates the configuration
5. System creates the contest and returns the commissioner to contest context

**Expected outcomes**
- Contest belongs to the league
- Contest is created with only the fields the product truly needs

### CC-002: Commissioner reviews and edits contest configuration before launch

**Actor:** Commissioner

**Preconditions**
- Contest exists
- Contest is still in an editable pre-live state

**Flow**
1. Commissioner opens contest configuration
2. Commissioner changes the allowed editable fields
3. System validates and saves the update

**Expected outcomes**
- Contest configuration remains truthful and constrained
- Editing rules are explicit and lifecycle-aware

## Required Model Review Before Implementation

Before backend or frontend implementation begins, perform a dedicated
data-model review of:

- `Contest`
- `ContestConfiguration`
- supporting DTOs, mappers, and generated contracts

The review must explicitly inspect:

- JSON fields and whether they are honest flexible payloads or modeling debt
- string fields that may actually be closed-set enums
- duplicate or speculative fields that should be removed before feature work
- DTO/entity/persistence alignment
- whether current configuration concepts belong on `Contest`,
  `ContestConfiguration`, or should be removed entirely

## Design Direction

- Start from the simplest truthful commissioner contest-creation flow
- Do not preserve generic engine fields just because they already exist
- Add model fields only when the product flow clearly needs them
- Reuse the new domain-model conventions and enum conventions during review

## Current Design Companion

The active golf-first configuration design for this lane is now captured in:

- [plans/98-golf-first-contest-configuration-design.md](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/plans/98-golf-first-contest-configuration-design.md)

That companion should be treated as the current developer handoff for:

- approved first golf contest config types
- commissioner defaults versus advanced controls
- event/participant fact-model expectations
- resolver snapshot responsibilities
- future-sport safety guardrails
