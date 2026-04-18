# Persona Flow

This document summarizes the default PoolMaster persona lifecycle.

## Artifact Hierarchy

- `requirements/` holds product requirement artifacts
- `tech-specs/` holds technical specification artifacts
- `plans/` remains the execution ledger and source of truth for active status

## Default Flow

1. `Pam` defines product requirements and use cases.
2. `Tom` converts those requirements into technical specs.
3. `Dom` supports Tom on domain-model and contract classification.
4. `Tess` derives the expected test matrix.
5. `Archie` turns requirements and specs into design plans and execution plans.
6. `Brad` implements backend/shared work.
7. `Fran` implements frontend work against the exported contract.
8. `Quinn` executes verification and reports release confidence.
9. `Riley` performs findings-first code review.

## Boundaries

- Pam owns product requirements, not schema or API design.
- Tom owns the technical-spec baseline.
- Archie consumes Tom's specs and records architectural decisions and rollout
  structure rather than duplicating the base spec.
- Tess plans coverage; Quinn executes verification.
- Plans in `plans/` still need task-row updates during execution.
