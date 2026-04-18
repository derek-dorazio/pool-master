# PoolMaster — Technical Specification Rules

Use this document when producing technical-spec artifacts under `tech-specs/`.

## 1. Purpose

Technical specifications translate approved product requirements into an
implementation-ready baseline for design plans and coding work.

These specs are the bridge between Pam's requirements and later design,
planning, testing, and implementation.

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
- `plans/` remain the execution/status source of truth
- when a technical spec materially changes an active feature lane, update the
  relevant plan notes or task rows too
