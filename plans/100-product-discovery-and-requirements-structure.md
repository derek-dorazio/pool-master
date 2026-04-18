## Purpose

Introduce a separate product-discovery persona and a clearer requirements folder
structure so high-level product framing and deep feature refinement have distinct
ownership and artifacts.

## Scope

- add `Piper` as the Product Discovery persona
- split `requirements/` into:
  - `requirements/reference/`
  - `requirements/product-overview/`
  - `requirements/product-requirements/`
- update workflow, agent, and requirements rules to reflect the new handoff
- migrate the current shared requirements placeholder files into the new
  structure

## Out Of Scope

- changing technical-spec or implementation workflow beyond the discovery ->
  requirements handoff
- rewriting existing feature requirements in depth
- contest implementation work

## Locked Direction

- `Piper` owns broad product framing and discovery
- `Pam` owns detailed product requirements and feature refinement
- `requirements/reference/` is the canonical seed-material folder
- `Piper` should also tolerate `projects/reference/` if materials are placed
  there instead
- `requirements/product-overview/` holds Piper output
- `requirements/product-requirements/` holds Pam output
- `plans/` remains the active execution-tracking source of truth

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 100-001 | 1 | Add Piper persona and discovery rules | Done | Added `agents/product-discovery.md` and `rules/product-discovery-rules.md`. |
| 100-002 | 1 | Reorganize requirements folder structure for reference, product-overview, and product-requirements | Done | Added the new subfolders, moved the shared placeholder files into `requirements/product-requirements/`, and added Piper scaffolding. |
| 100-003 | 1 | Update AGENTS, persona flow, and workflow rules for the Piper -> Pam handoff | Done | Updated shared docs and Pam guidance to make the new ownership explicit. |
| 100-004 | 1 | Reconcile plan after the workflow/docs changes are complete | Done | This slice is doc-only and does not require test execution. |
