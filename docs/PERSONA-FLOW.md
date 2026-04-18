# Persona Flow

This document summarizes the default PoolMaster persona lifecycle.

## Artifact Hierarchy

- `requirements/reference/` holds discovery seed materials
- `requirements/product-overview/` holds Piper's discovery artifacts
- `requirements/product-requirements/` holds Pam's refined requirement artifacts
- `tech-specs/` holds technical specification artifacts
- `plans/` remains the execution ledger and source of truth for active status

## Default Flow

1. `Piper` frames the product broadly and produces the product-overview bundle.
2. `Pam` defines detailed product requirements and use cases.
3. `Tom` converts those requirements into technical specs.
4. `Dom` supports Tom on domain-model and contract classification.
5. `Tess` derives the expected test matrix.
6. `Archie` turns requirements and specs into design plans and execution plans.
7. `Brad` implements backend/shared work.
8. `Fran` implements frontend work against the exported contract.
9. `Quinn` executes verification and reports release confidence.
10. `Riley` performs findings-first code review.

## Boundaries

- Piper owns broad product framing and discovery, not deep feature refinement.
- Pam owns refined product requirements, not schema or API design.
- Tom owns the technical-spec baseline.
- Archie consumes Tom's specs and records architectural decisions and rollout
  structure rather than duplicating the base spec.
- Tess plans coverage; Quinn executes verification.
- Plans in `plans/` still need task-row updates during execution.
