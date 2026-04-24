# PoolMaster — Technical Specification Rules

Use this document when producing technical-spec artifacts under `tech-specs/`.

## 0. When To Write A Tech Spec (And When Not To)

Tech specs are **pre-implementation planning artifacts**. They exist to translate a reviewed product requirement into an implementation-ready technical baseline *before* the code is written. They are **not** permanent reference documents.

### Write a tech spec when all of the following apply

- The work is a **major** new feature or architectural change that introduces substantial new domain types, API surfaces, or integration patterns.
- The product requirements are approved (a `requirements/product-requirements/features/<feature>/` bundle exists and is current).
- Implementation has **not yet started**, and writing the spec will meaningfully reduce ambiguity or rework during coding.

### Skip the tech spec when

- The work fits within an existing feature's contract (no new domain types, no new endpoints, no new integration patterns).
- The scope is an incremental change, bug fix, UX refinement, or targeted refactor.
- Implementation has already begun and the design is emerging through code review.
- Generated SDK types + existing tests already describe the behavior the slice would need to redocument.

For all skip cases, capture the technical narrative directly in the plan file (`plans/NN-*.md`) instead of creating a parallel `tech-specs/` artifact.

### Tech specs have a lifetime; they are deleted, not archived

Once a feature's implementation ships (lands on `main`, is covered by tests, and the generated SDK reflects the final contract), the pre-implementation tech spec is **deleted in the same cleanup pass**. The code + tests + generated types + OpenAPI descriptions are the authoritative post-ship spec. Maintaining a parallel prose spec after implementation creates a drift risk without compensating value.

If a durable technical decision was made during spec work that outlasts the feature (e.g. a new pattern, a cross-cutting choice), record it as an ADR in `docs/adr/` before deleting the spec.

## 1. Purpose

Technical specifications translate approved product requirements into an
implementation-ready baseline for design plans and coding work — during the
pre-implementation phase of a major feature. See §0 for when to write one and
when to skip.

These specs are the bridge between Pam's requirements and later design,
planning, testing, and implementation — not the long-term home for either.

## 2. Output Structure

Tom's normal feature bundle is:

- `tech-specs/features/<feature>/domain-model.md`
- `tech-specs/features/<feature>/api-surface.md`
- `tech-specs/features/<feature>/flows.md`
- `tech-specs/features/<feature>/open-questions.md`
- `tech-specs/features/<feature>/test-matrix.md` when Tess is involved

## 3. Domain Model Spec Rules

`domain-model.md` should cover:

- important entities/concepts
- ownership of each concept:
  - domain type
  - DTO
  - persistence model
  - derived read model only
- enum candidates / closed sets
- lifecycle/status semantics
- model changes or cleanup implications

Do not treat current implementation drift as automatically correct. Call out
confirmed drift explicitly.

## 4. API Surface Spec Rules

`api-surface.md` should normally include a compact table or equivalent listing:

- operation / endpoint
- actor / permission
- request shape summary
- response shape summary
- notes / constraints

Prefer describing contract meaning, not copying raw schemas in full.

## 5. Flow Spec Rules

`flows.md` should capture:

- end-to-end flow sequence
- state transitions
- branching/error points
- interactions between UI, API, and background/system processes

This file should make it easier for Archie, Brad, Fran, Tess, and Quinn to
reason about the feature slice without reverse-engineering the code.

## 6. Open Questions

`open-questions.md` should separate:

- blocking questions
- non-blocking follow-ups
- known drift between product intent and current implementation

## 7. Cross-Check Requirements

Before a technical spec is considered complete, cross-check it against:

- the relevant `requirements/` feature artifacts
- active execution plans in `plans/`
- current shared domain types
- current DTOs
- generated SDK/OpenAPI outputs where relevant

If the current implementation contradicts approved product direction, record the
mismatch instead of flattening them together.

## 8. JIT Invocation

Technical specs should be created or refreshed when:

- requirements exist
- implementation is approaching
- and no current trustworthy technical spec exists

Do not use technical specs to bypass unresolved product questions.

## 9. Handoff Floor

Before technical specs are handed forward, they must make clear:

- what concepts and contracts are affected
- where Dom review is required
- what Archie should treat as the baseline
- what Brad and Fran should implement against
- what Tess should plan coverage against

## 10. Interaction With Plans

- `tech-specs/` are design inputs and handoff artifacts
- `plans/` remain the execution/context layer, not the technical source of
  truth
- when a technical spec materially changes an active feature lane, update the
  relevant plan notes or task rows too
