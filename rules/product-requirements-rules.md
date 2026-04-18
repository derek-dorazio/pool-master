# PoolMaster — Product Requirements Rules

Use this document when producing product requirements artifacts under
`requirements/`.

## 1. Purpose

Product requirements should define **what the product must do** and **how users
experience it**, without collapsing into schema, DTO, route, or architecture
implementation details.

These artifacts are design inputs. They do not replace active execution plans
under `plans/`.

## 2. Output Structure

Pam's normal output bundle is:

### Shared Product Files

- `requirements/product-requirements.md`
- `requirements/roles-and-actors.md`
- `requirements/glossary.md`
- `requirements/domain-concepts.md`
- `requirements/navigation-and-entry-points.md`

### Feature Files

- `requirements/features/<feature>/overview.md`
- `requirements/features/<feature>/use-cases.md`
- `requirements/features/<feature>/screens.md`
- `requirements/features/<feature>/business-rules.md`
- `requirements/features/<feature>/open-questions.md`

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

## 8. Handoff Floor

Before product requirements are handed forward, they must make clear:

- who the actors are
- what the core use cases are
- what the business rules are
- what the screen purposes and entry points are
- what is confirmed vs open
- what technical/model implications are already visible

## 9. Interaction With Plans

- `requirements/` artifacts are inputs and handoff materials
- active implementation tracking still belongs in `plans/`
- when a requirement materially changes an active feature lane, update the
  relevant plan notes or task rows in the same effort
