# ADR 0003: Tech Specs Are Pre-Implementation Planning Artifacts; Deleted After Ship

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Tech specs (`tech-specs/features/<feature>/domain-model.md`, `api-surface.md`, `flows.md`, `open-questions.md`) were originally positioned as durable technical reference documents for each feature — domain concepts, API shapes, flow diagrams, etc. — produced by the Technical Specification persona (Tom) as a handoff to backend and frontend implementation.

In practice this layer has two failure modes at scale:

1. **Post-ship drift.** Once the feature is implemented, the authoritative description of domain shapes is the code (generated SDK types, Prisma schema, DTO Zod schemas, OpenAPI descriptions, tests). The prose spec requires a separate maintenance pass every time the contract changes, and that pass is not reliably done. The spec becomes stale and starts to actively mislead new contributors who assume it's current.

2. **Internal duplication.** Specs re-describe concepts that are already stated in `requirements/product-requirements/features/<feature>/` (business rules, concept ownership) and that are already expressed in generated types. The audit of the PoolMaster repo found internal copy-paste duplication inside a single spec file (`tech-specs/features/contest-event-feed-integration/domain-model.md` lines 291–393 duplicated at 364–434), indicating specs are not being actively maintained even when nominally "owned."

For major new feature work, the pre-implementation value of a tech spec is real — Tom writes it, Brad/Fran read it, consensus is reached before code. That value evaporates the moment implementation lands and the generated contract becomes the authority.

## Decision

Tech specs are **pre-implementation planning artifacts only**.

- Write a tech spec **only** when (a) the work is a major new feature or architectural change introducing substantial new domain types / APIs / integration patterns, and (b) implementation has not yet started, and (c) the spec will meaningfully reduce ambiguity.
- **Skip the tech spec** for incremental work, UX refinements, bug fixes, or changes within an existing feature's contract. Capture technical notes in the plan file (`plans/NN-*.md`) instead.
- **Delete the tech spec** when the implementation ships (lands on `main`, is covered by tests, and the generated SDK reflects the final contract). The code + tests + generated types + OpenAPI descriptions become the authoritative post-ship spec.
- If a durable technical decision was made during spec work (a new pattern, a cross-cutting choice), capture it as an ADR **before** deleting the spec.

## Consequences

**Positive**

- Eliminates the post-ship drift failure mode by removing the drifting artifact.
- Removes the maintenance burden for 80% of work where no new spec is needed.
- The generated SDK and tests become unambiguously the source of truth for technical shape, which is already true in practice.
- Reduces the artifact count in the repo and simplifies onboarding.

**Tradeoffs / new constraints**

- Contributors who prefer prose specs as a technical reference must rely on generated types + code + tests instead. For complex domains, the learning curve is real.
- The "delete when it ships" step requires discipline; forgotten specs will drift and must be caught in cleanup sweeps.
- Durable technical decisions that would previously have been absorbed into prose specs must now be explicitly written as ADRs, or they vanish when the spec is deleted.

## Alternatives considered

- **Keep tech specs as durable reference documents.** Rejected: the drift failure mode is systematic, not a discipline problem. The cost of keeping parallel prose accurate to generated contract is higher than the value.
- **Keep tech specs but require them to be regenerated from the code automatically.** Rejected: tooling complexity; the generated types + OpenAPI descriptions already serve this purpose.
- **Replace prose specs with inline code comments and rich DTO descriptions.** Partially adopted via `rules/service-rules.md` documentation requirements; this ADR goes further by retiring the `tech-specs/` layer after ship rather than maintaining it in parallel.
