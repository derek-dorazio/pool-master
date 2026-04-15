# PoolMaster — Application Specification Rules

## 1. Purpose

Application specifications exist to describe how PoolMaster can be recreated or
re-implemented from scratch without coupling the specification to the current
technology stack.

These specifications are for:

- future planning agents
- implementation agents
- design-review agents
- rebuild or migration efforts

They are not architecture source code, not UI component docs, and not a copy of
the implementation.

## 2. Specification Principles

Application specs must be:

- technology-neutral
- architecture-neutral where possible
- role- and flow-oriented
- bounded-context aware
- grounded in current source-of-truth behavior
- explicit about uncertainty or drift

Application specs must not:

- prescribe framework-specific implementation details
- duplicate every current code detail
- restate generated contracts unnecessarily when they already exist as source of
  truth
- infer missing behavior silently

## 3. Source-of-Truth Hierarchy

When building or updating a specification, use this hierarchy:

1. reviewed product/use-case plans
2. current domain-model semantics
3. exported DTOs/OpenAPI/generated types
4. current implemented behavior in app and service code

If these disagree:

- prefer the reviewed plan if the implementation is clearly lagging or drifting
- prefer the implementation only when it clearly supersedes an older plan
- mark unresolved differences as `Needs Review`

## 4. What Specifications Should Describe

For each feature area, describe:

- feature purpose
- primary actors and roles
- business capabilities
- user/use cases
- primary user flows
- domain concepts and their relationships
- API signatures and interaction points
- page/screen purposes
- page transitions and page-to-API interactions
- rules, constraints, and lifecycle behavior
- known edge cases
- known deferred areas

## 5. What Specifications Should Not Describe In Detail

Unless a feature genuinely requires it, do not over-specify:

- component hierarchy
- styling or layout
- CSS/system design choices
- framework hooks, state libraries, or transport-layer mechanics
- internal implementation wiring already implied by exported APIs and types

Screen specs should explain:

- what the page is for
- who uses it
- what actions it supports
- what backend/API interactions it relies on
- what state transitions matter

Screen specs should not dictate:

- exact component composition
- visual spacing
- grid/flex layouts
- file/module structure for the implementation

## 6. Relationship To API Contracts

PoolMaster treats exported API routes and DTO types as current implementation
source of truth.

Therefore:

- do not duplicate low-level route/request/response details into every screen
  spec
- instead, reference the route group or API surface and summarize its purpose
- include API signatures when useful for rebuild guidance:
  - route
  - method
  - purpose
  - request DTO name
  - response DTO name
- avoid copying full generated payload definitions unless the spec is for API
  reconstruction itself

## 7. Output Folder Structure

Application specifications should live under `specs/`.

Recommended structure:

```text
specs/
  README.md
  shared/
    glossary.md
    roles-and-actors.md
    navigation-and-entry-points.md
  domains/
    <domain-slug>/
      overview.md
      use-cases.md
      domain-model.md
      api-surface.md
      screens.md
      flows.md
      open-questions.md
```

Where:

- `shared/glossary.md`
  - canonical terminology
  - UI term vs model term mappings
- `shared/roles-and-actors.md`
  - role definitions and capability summary
- `shared/navigation-and-entry-points.md`
  - global navigation, entry points, and cross-domain routing concepts
- `domains/<domain-slug>/overview.md`
  - purpose, scope, actors, and current truth summary
- `domains/<domain-slug>/use-cases.md`
  - user/use cases and acceptance-style behavioral descriptions
- `domains/<domain-slug>/domain-model.md`
  - domain nouns, relationships, lifecycle semantics, and canonical field-level
    concepts
- `domains/<domain-slug>/api-surface.md`
  - route inventory, request/response DTO names, and intent summary
- `domains/<domain-slug>/screens.md`
  - page purposes, page actions, data dependencies, and transitions
- `domains/<domain-slug>/flows.md`
  - end-to-end flow narratives and state transitions
- `domains/<domain-slug>/open-questions.md`
  - drift, ambiguity, deferred work, and review-required items

## 8. File Content Rules

### `overview.md`

Must include:

- purpose
- in-scope actors
- major capabilities
- dependencies on other domains
- current implementation status summary

### `use-cases.md`

Must include:

- actor
- goal
- preconditions
- normal flow
- postconditions
- notable edge cases

### `domain-model.md`

Must include:

- canonical domain concepts
- relationships
- lifecycle semantics
- important invariants
- UI term vs model term mapping when those differ intentionally

### `api-surface.md`

Must include:

- route/method
- purpose
- actor/role allowed
- request DTO type
- response DTO type
- notable behavioral rules

### `screens.md`

Must include:

- page/screen name
- route or entry point
- page purpose
- key actions
- key read-only information
- dependent API calls or query surfaces
- transitions to other pages or states

### `flows.md`

Must include:

- trigger
- main steps
- state transitions
- alternative/error paths where important

### `open-questions.md`

Must classify each item:

- `Confirmed Drift`
- `Needs Review`
- `Deferred`

## 9. Spec Writing Style

Write specs so a fresh implementation team can use them.

Preferred style:

- concise prose
- flat lists where useful
- tables for route inventories and page inventories
- explicit labels for:
  - confirmed behavior
  - inferred behavior
  - needs review

Avoid:

- marketing copy
- implementation trivia
- long code excerpts
- architecture-specific jargon unless the concept is truly part of the product
  behavior

## 10. Handoff Usefulness Requirement

Every spec should be useful to downstream agents for one or more of:

- planning a new execution lane
- reviewing model changes
- implementing backend contracts
- implementing frontend screens
- designing test coverage

If a spec cannot support those downstream tasks, it is too vague and must be
improved.

## 11. Change Maintenance

When application behavior changes materially:

- update the relevant spec files
- remove or mark stale behavior explicitly
- do not let specs silently drift behind reviewed product truth

If a spec becomes fully superseded:

- update the replacement spec in the same slice
- mark the old section or file as superseded, or remove it if history is no
  longer useful
