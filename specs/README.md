# PoolMaster Specifications

The `specs/` directory holds technology-neutral application specifications that
describe how PoolMaster can be recreated or re-implemented from scratch.

These files are intended to support:

- planning agents
- backend and frontend implementation agents
- product and model review
- future rebuild or migration work

They are not meant to duplicate the current codebase line by line.

## Directory Structure

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

## File Intent

- `shared/glossary.md`
  - canonical terminology and important term mappings
- `shared/roles-and-actors.md`
  - role definitions and major capability boundaries
- `shared/navigation-and-entry-points.md`
  - top-level routes, entry points, and global navigation concepts
- `domains/<domain-slug>/overview.md`
  - feature/domain purpose and scope
- `domains/<domain-slug>/use-cases.md`
  - role-oriented use cases and functional expectations
- `domains/<domain-slug>/domain-model.md`
  - domain nouns, relationships, lifecycle behavior, and invariants
- `domains/<domain-slug>/api-surface.md`
  - route inventory with request/response type references
- `domains/<domain-slug>/screens.md`
  - page purposes, actions, and page-to-API relationships
- `domains/<domain-slug>/flows.md`
  - end-to-end flow descriptions and state transitions
- `domains/<domain-slug>/open-questions.md`
  - unresolved items, confirmed drift, and deferred work

## How Implementation Agents Should Use These Specs

Implementation agents should treat these files as rebuild requirements and use
them to:

- create or update execution plans
- confirm product intent before coding
- identify model or contract implications
- map screens to API usage without reverse-engineering every route from scratch

When a spec and implementation disagree:

- check the active plans
- check the exported contracts
- document the mismatch explicitly before assuming either side is correct
