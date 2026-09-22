# Plan 137 — Test Selector Strategy by Layer

**Tracking issue:** #136

## Purpose

Split the test selector rule by layer, so component tests recover the accessibility signal
the current rule discards.

`testing-rules.md §6` *React Testing Library Selector Rule* says: "Do not use visible
string literals as the default selector strategy for automation-critical UI. Prefer
`getByTestId`, stable field `id`s, and other machine-oriented selectors."

That is correct for Playwright and wrong for React Testing Library.

## Triggering Finding

Testing Library's own priority guidance ranks queries by how closely they resemble how
users find elements: `getByRole` first, and `getByTestId` explicitly **last**, on the
grounds that test IDs are invisible to users and prove nothing about whether the element
is actually reachable.

The practical consequence is not stylistic. `getByRole('button', { name: 'Save' })` fails
when the accessible name breaks — a missing label, an icon-only button with no
`aria-label`, a div wearing a click handler. That failure is the test doing its job.
`getByTestId('save-btn')` passes through all of those.

So the current rule does not merely deviate from convention — it removes the mechanism
that would catch accessibility regressions automatically. Felix's `A11Y` finding category
existed to catch them by review instead, and Plan 133 retires Felix.

The stability argument the rule is built on is sound for a different context: Playwright
deploy-gate journeys run against a deployed app where copy changes, translations, and
marketing edits should not break the pipeline. That reasoning does not transfer to
component tests running against a fixed render.

## Key Decision

Split the rule by layer.

**React Testing Library (component and page tests):**

- `getByRole` with an accessible name is the default.
- `getByLabelText` for form fields.
- `getByTestId` only where no accessible query can reach the element, and that is a
  finding — an element no accessible query can reach is usually an accessibility defect,
  not a selector problem.
- Text queries are fine; these tests run against a fixed render, not shifting deployed
  copy.

**Playwright (deploy-gate browser journeys):**

- Unchanged. `data-testid` for interactive controls, semantic `id` for form inputs,
  `data-testid` for page landmarks.
- Copy-based locators stay banned except where validating copy is the point.

The rule text should state *why* each layer differs, since the two halves otherwise read
as a contradiction to anyone applying one without the other.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 136** restructures `testing-rules.md §2`, `§3`, and `§6`. This plan edits `§6`'s
  selector subsections. Sequence after 136.
- **Plan 133** retires Felix, removing the review-based a11y check. That makes this change
  more valuable, not less — it is the automated replacement for a lens that is going away.

## Execution Sequence

Single slice: rewrite the two selector subsections in `testing-rules.md §6` with the
layer split and the rationale.

Migrating existing RTL tests from `getByTestId` to `getByRole` is **not** in scope. The
rule changes for new and touched tests; a sweep of the existing suite is a separate
question, and likely a larger one, since tests that cannot be migrated are surfacing real
accessibility defects that need fixing rather than reselecting.

## Open Questions

- **Is a migration sweep worth scheduling?** Converting existing RTL tests would surface
  accessibility defects as failures. That is valuable and disruptive in the same motion,
  and the volume is unknown without a count.
- **Should an ESLint rule enforce this?** `eslint-plugin-testing-library` has
  `prefer-query-matchers` and related rules. Worth folding into Plan 135 rather than
  writing a scanner.

## Sources / Prior Decisions

- Plan 133 — Persona library to task-shaped skills (retires Felix's A11Y lens)
- Plan 135 — Rule scanners to ESLint (possible enforcement home)
- Plan 136 — Test runner and layer consolidation (restructures the same file)
