# PoolMaster — Product Requirements Rules

Use this document when producing refined product-requirement artifacts under
`requirements/product-requirements/`.

## 0. When To Write A Requirements Bundle (And When To Skip)

The Piper/Pam requirements bundle — overview + use-cases + screens + business-rules + open-questions for a feature — is high-leverage for **major new features** on a mostly-greenfield surface. It is low-leverage and often net-negative for incremental work on features that already exist.

### Write a requirements bundle when all of the following apply

- The feature is genuinely new (not already covered by an existing feature bundle).
- It introduces new actors, new domain concepts, new navigation surfaces, or substantially new product behavior.
- Product decisions benefit from shared framing *before* design/implementation begins.

### Skip the bundle when

- The work fits within an existing feature's bundle (no new actors, no new concepts, no new primary surfaces).
- The scope is a UX refinement, incremental improvement, or bug-class fix.
- Rewriting the requirements would mostly duplicate what already exists.

For skip cases, capture the product intent directly in the plan file (`plans/NN-*.md`) — just enough narrative for the slice author to do the work. Do not create a parallel requirements artifact.

### Bundles have a lifetime

When a feature has shipped and stabilized, trim the bundle to only what still describes *current* product intent. Delete exploratory open-questions that were answered by shipping. Delete entire bundles for features that are no longer active product scope (e.g. retired surfaces, archived apps).

## 1. Purpose

Product requirements should define **what the product must do** and **how users
experience it**, without collapsing into schema, DTO, route, or architecture
implementation details.

These artifacts are design inputs for major features (see §0). They are not
the home of task status — that lives in Beads.

## 2. Output Structure

Pam's normal output bundle is:

### Shared Product Files

- `requirements/product-requirements/product-requirements.md`
- `requirements/product-requirements/roles-and-actors.md`
- `requirements/product-requirements/glossary.md`
- `requirements/product-requirements/domain-concepts.md`
- `requirements/product-requirements/navigation-and-entry-points.md`

### Feature Files

- `requirements/product-requirements/features/<feature>/overview.md`
- `requirements/product-requirements/features/<feature>/use-cases.md`
- `requirements/product-requirements/features/<feature>/screens.md`
- `requirements/product-requirements/features/<feature>/business-rules.md`
- `requirements/product-requirements/features/<feature>/open-questions.md`

Pam should normally read Piper's discovery output from:

- `requirements/product-overview/`

before deep refinement begins.

## 3. Confidence Labels

Use these labels where meaning or certainty matters:

- `(Confirmed)`
- `(Inferred)`
- `(Needs Review)`

Default rule:

- current approved user decisions, active plans, and implemented truth can be
  marked `(Confirmed)`
- synthesis from multiple inputs without direct explicit approval should be
  marked `(Inferred)`
- unresolved or risky assumptions should be marked `(Needs Review)`

## 4. Use-Case Template

Each important use case should normally include:

- Use-case ID / title
- Actor(s)
- Preconditions
- Trigger
- Main flow
- Alternate flows
- Error paths
- Expected outcomes
- Acceptance criteria
- Related business rules

## 5. Screen Documentation Rules

Screen docs should describe:

- screen purpose
- actor visibility / permissions
- primary actions
- major states
- dependencies on backend or other flows
- entry and exit points

Screen docs should **not** become component trees or layout blueprints.

## 6. Business Rules

Business-rule docs should separate:

- product rules
- permission rules
- lifecycle rules
- validation rules

Do not bury business-critical rules only inside prose use cases when they are
reused across multiple flows.

## 7. Mode B Visual Extraction

When visual references are used:

- extract product meaning, not implementation mimicry
- explicitly note what the visuals:
  - confirm
  - inspire
  - leave unresolved
- avoid treating spacing, layout, or legacy control placement as mandatory
  unless the user explicitly says so
- when visuals would materially improve product-definition accuracy, ask for
  targeted screenshots or examples rather than silently inferring important UX
  behavior from incomplete prose

## 8. Handoff Floor

Before product requirements are handed forward, they must make clear:

- who the actors are
- what the core use cases are
- what the business rules are
- what the screen purposes and entry points are
- what is confirmed vs open
- what technical/model implications are already visible

## 9. Interaction With Other Layers

The layered artifact model is owned by `rules/workflow-rules.md §0 Document Lifecycle`. This rule file only adds Pam-specific notes:

- `requirements/product-requirements/` is authoritative for *major-feature* product intent while the feature is active.
- When requirement changes affect in-flight work, update the relevant plan narrative in the same effort; task state is updated in Beads (not in plan task tables — plan files no longer carry task tables).
- If older plan prose contradicts current refined requirements, requirements wins; plan prose should be reconciled or the plan deleted if its epic has closed.
- Do not surface product questions from older plan prose without first checking current `requirements/product-requirements/` feature files.

## 10. Continuous Propagation

- refined product requirements are not write-once artifacts
- when active design discussions resolve product meaning, actor behavior,
  lifecycle rules, navigation assumptions, or cross-feature product goals,
  propagate those decisions upward into the shared product-requirement files in
  the same lane
- do not leave important product truth trapped only inside a localized feature
  slice if it changes the broader product model, actor definitions, or product
  goals
- when a resolved feature-level decision materially changes high-level product
  framing, also update the matching `requirements/product-overview/` artifacts
  so discovery and refined requirements stay aligned
