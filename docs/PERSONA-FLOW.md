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
10. **PR review (multi-pass, see below)**: `Riley` Pass 1 (implementer self-check, in PR body marker) → `Riley` Pass 2 (cross-model secondary, via `gh pr review`) → optionally `Sage` Pass 3 (security) and/or `Archie` Pass 4 (architecture) when the slice triggers them.

## PR Review Lanes (multi-pass)

Every PR landing on `main` flows through a multi-pass review. The full process model is in `rules/workflow-rules.md §6` *Branching, Review, and Merge Cadence*.

| Pass | Persona | Always runs? | Where it appears |
|---|---|---|---|
| 1 | `Riley` (implementer self-check) | Always | PR body marker `<!-- riley:findings -->` |
| 2 | `Riley` (cross-model secondary) | Always | `gh pr review` from a different GitHub App identity |
| 3 | `Sage` (security focus) | When slice touches auth, validation, secrets, data exposure | `gh pr review` from a separate App identity |
| 4 | `Archie` (architecture pattern check) | When slice touches shared contracts, cross-module boundaries, infrastructure, or active plans/ADRs | `gh pr review` from a separate App identity |

Pass 2 is what satisfies branch protection's `required_approving_review_count: 1` (a non-author App identity approving the PR). Pass 1 is in the PR body marker and CI-enforced via `npm run rules:check:pr-riley-marker`.

Each `gh pr review` post (Passes 2/3/4) starts with the persona+pass+model header per `workflow-rules.md §6`:

```
> _<Persona> review · <pass type> · <model identity>_

**Vote: APPROVE** | **Vote: REQUEST CHANGES** | **Vote: COMMENT**
```

For the GitHub Apps identity setup, see `docs/CI-AND-QUALITY-GATES.md` *GitHub App setup runbook* section.

## Boundaries

- Piper owns broad product framing and discovery, not deep feature refinement.
- Pam owns refined product requirements, not schema or API design.
- Tom owns the technical-spec baseline.
- Archie consumes Tom's specs and records architectural decisions and rollout
  structure rather than duplicating the base spec. Archie also runs as a PR
  reviewer (Pass 4) when invoked.
- Tess plans coverage; Quinn executes verification.
- Riley is the generalist reviewer. Sage is the security-focused reviewer.
  These lenses are complementary; PRs touching security-sensitive paths get
  both Riley (always) and Sage (conditional). Sage does not do generalist
  review — that's Riley's lane.
- Plans in `plans/` still need narrative updates during execution; task state
  lives in Beads, not in plan files.
