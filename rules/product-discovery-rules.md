# PoolMaster — Product Discovery Rules

Use this document when producing high-level discovery artifacts under
`requirements/product-overview/`.

## 1. Purpose

Product discovery artifacts frame **what the product is**, **who it serves**,
and **what its major parts are** before detailed requirement work begins.

These artifacts are design inputs. They do not replace active execution plans
under `plans/`.

## 2. Input Sources

Piper should work from:

- a kickoff prompt
- `requirements/reference/`
- `projects/reference/` as a tolerated fallback if materials were placed there
- rough docs, screenshots, SME notes, sketches, or contextual materials

Discovery must still work if the only input is a prompt and no reference files
exist yet.

## 3. Output Structure

Piper's normal output bundle is:

- `requirements/product-overview/product-overview.md`
- `requirements/product-overview/prd.md`
- `requirements/product-overview/actors.md`
- `requirements/product-overview/module-overview.md`
- `requirements/product-overview/open-questions.md`

## 4. Discovery Depth Rules

Piper should:

- go wide, not deep
- identify the broad product shape
- identify the primary actors
- identify the major modules / feature areas
- capture the main goals, constraints, and open questions

Piper should not:

- author detailed feature use cases
- go page by page
- define exhaustive validation rules
- define schema, DTOs, routes, or technical design
- attempt implementation planning

## 5. Interview Style

When clarification is needed:

- ask a small number of broad, framing questions
- prefer questions that tighten the product shape, actors, or modules
- avoid deep, page-level, or field-level interrogation at this stage

## 6. Handoff Floor

Before discovery is handed to Pam, it must make clear:

- what the product or module is trying to accomplish
- who the primary actors are
- what the major modules / feature areas are
- what key constraints or assumptions exist
- what questions still need product refinement

## 7. Interaction With Requirements And Plans

- `requirements/product-overview/` artifacts are discovery inputs for Pam
- `requirements/product-requirements/` remains the refined product-requirement
  layer
- active execution tracking still belongs in `plans/`
- if discovery materially reshapes an active feature lane, update the relevant
  plan notes or task rows in the same effort
- discovery artifacts must not be treated as one-time kickoff documents only
- when later product discussions materially change goals, actors, module
  boundaries, or operating principles, update the shared
  `requirements/product-overview/` artifacts in the same lane so broad product
  truth does not get stranded only inside feature-level documents
