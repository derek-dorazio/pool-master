# Plan 135 — Rule Scanners to ESLint

**Tracking issue:** #134

## Purpose

Migrate the bespoke rule scanners to ESLint rules where the rule is expressible there, so
violations surface at write time in the editor rather than at push time in CI.

The repo has 13 custom scanners under `scripts/check-*.mjs`, wired through
`npm run rules:check`. The instinct — repo conventions as executable checks rather than
prose in a CONTRIBUTING file — is right and under-adopted. The implementation is the
problem: a Node script that greps the tree gives no editor feedback, no autofix, and no
per-line escape hatch with a recorded justification.

## Governing Principles

- **Feedback belongs as close to authoring as possible.** A squiggle while typing beats a
  CI failure after push.
- **An escape hatch with a justification beats no escape hatch.** `eslint-disable-next-line`
  with a reason comment is reviewable; a scanner allowlist buried in a script is not.
- **Not everything is an ESLint rule.** Project-wide analysis and non-code checks stay
  scripts, and saying so explicitly is part of the design.

## Key Decisions

### 1. Three-way split of the current scanner set

**Already covered by existing plugins — near-free:**

| Scanner | Replacement |
|---|---|
| `check-unsafe-casts` | `@typescript-eslint/no-explicit-any` and the `no-unsafe-*` family |
| `check-no-non-sdk-fetch` | `no-restricted-globals` for `fetch`, `no-restricted-imports` for `axios`, scoped to `clients/poolmaster/src` via overrides |
| `check-test-disable-discipline` (detection half) | `eslint-plugin-vitest` / `eslint-plugin-jest` `no-disabled-tests`; the adjacent-`SKIP:`-comment requirement needs a small custom rule |

**Custom ESLint rules — good fit:**

| Scanner | Approach |
|---|---|
| `check-route-discipline` | `no-restricted-imports` for Prisma in route files via path overrides, plus custom rules for `SuccessSchema`, handler-level `.map()`, and inline object schemas |
| `check-no-inline-query-keys` | `no-restricted-syntax` on array literals in `queryKey:` position |
| `check-no-inline-theme-styles` | `no-restricted-syntax` on style props carrying raw color literals |
| `check-shared-ui-controls` | `no-restricted-syntax` on bare JSX controls where a shared primitive exists |
| `check-no-env-fallbacks` | `no-restricted-syntax` on `import.meta.env.X ?? …` and `process.env.X ?? …` |
| `check-no-duplicate-extract-error-message` | `no-restricted-imports` plus a local-redeclaration rule |
| `check-test-traceability` | Custom rule on test files — **but see Plan 138**, which may retire this rule entirely |

**Stays a script — correctly so:**

| Scanner | Why |
|---|---|
| `check-no-parallel-api-types` | Requires cross-file knowledge of the generated types file; ESLint's per-file model fits badly |
| `check-openapi-fresh` | Regenerates artifacts into a temp dir and diffs — not a lint concern |
| `check-pr-review-triggers` (née riley-marker) | Inspects the PR body, not the tree |

**Uncertain, decide during execution:**

- `check-no-mocked-api` — the concrete patterns (`initialData: mockData`,
  `queryFn: async () => mockData`, `catch { return mockData }`) are expressible; the
  general "is this fake data" judgment is not. Likely a partial migration where ESLint
  catches the enumerated shapes and the script retains the broader sweep.
- `check-form-query-mirror` — the "more than two fields uses React Hook Form" rule is
  semantic enough that a faithful ESLint implementation may not be worth it.

### 2. ESLint severity replaces the warn-only baseline mechanism

Seven scanners currently run `--warn-only` with an acknowledged backlog, which means CI
passes while reporting known violations. ESLint has a native, better-understood version of
the same idea:

- `"warn"` for rules with an existing backlog, surfaced in the editor without failing CI
- `"error"` for rules with a clean baseline
- `--max-warnings 0` on a per-directory basis as areas get cleaned
- `eslint-disable-next-line` with a required description for genuine exceptions

This subsumes the baseline strategy Plan 123 was going to design.

### 3. This plan supersedes `pool-master-5xi.2`

Plan 123's epic and all four of its slices are `open` — none were ever started. The
scanners still run `--warn-only`, which is the observable confirmation. It is a recorded
findings document from June 2026, not work in flight, so there is no active lane to
disturb.

`pool-master-5xi.2` — "convert warning-only rule scanners into enforceable baselines" —
describes this plan's goal by a different mechanism. Migrating to ESLint *is* the
conversion to enforceable, because severity and disable-comments are the baseline
mechanism. The slice is closed as superseded.

**The rest of Plan 123 needs disposition too**, since it was written while the workflow was
being *strengthened* and parts of it now point the opposite way from Plans 132 and 133:

| Slice | Disposition |
|---|---|
| `5xi.1` Enforce shared lifecycle enum usage | **Goal still valid**, mechanism changes. It calls for "a blocking scanner for lifecycle literals in production app code" — under this plan that is an ESLint rule, not a script. Fold the rule into this plan's custom-rule set; the `SportEventStatus` shared-constant work stays its own slice. |
| `5xi.2` Convert warn-only scanners | **Superseded by this plan.** |
| `5xi.3` Implementation-analysis approval gate | **Dropped.** It required a pre-code analysis artifact — current code inventory, contract chain, file-by-file delta, reviewer evidence checklist — approved before coding starts, for any slice touching shared contracts or lifecycle behavior. That is substantial ceremony, proposed when the multi-pass review flow was being reinforced. Plans 132 and 133 remove ceremony on the grounds that it costs more than it returns; keeping both would be incoherent. Closed without implementation. |
| `5xi.4` Strengthen frontend generated-contract discipline | **Partly absorbed.** Its concrete ask — make API-shaped frontend models derive from generated operation response types — overlaps `check-no-parallel-api-types`, which this plan keeps as a script precisely because it needs cross-file knowledge. Worth keeping as a slice, scoped to strengthening that one scanner. |

Plan 123 is then deleted per ADR-0002, with `5xi.1` and `5xi.4` re-homed here and the
lifecycle-enum domain work tracked separately.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 123** — unstarted; this plan absorbs or supersedes three of its four slices per
  decision 3. Not a blocker, but its disposition should land in the same effort so the
  plan file can be deleted rather than left implying work that has moved.
- **Plan 138** — if traceability is retired, `check-test-traceability` needs no migration.
  Sequencing 138 first avoids building a rule that is then deleted.
- **Plan 136** — migrating to Vitest changes which test-lint plugin applies
  (`eslint-plugin-vitest` vs `eslint-plugin-jest`). Sequencing 136 first avoids configuring
  the wrong one.

## Execution Sequence

**First — the near-free migrations.** `unsafe-casts`, `no-non-sdk-fetch`, and the
detection half of test-disable. These need configuration, not rule authoring, and
immediately prove the approach on real violations.

**Second — custom rules, highest-traffic first.** Route discipline and the frontend rules
fire most and benefit most from editor feedback.

**Third — retire the migrated scripts** and shrink `rules:check` to the scripts that
remain.

**Fourth — Plan 123 disposition.** Close `5xi.2` as superseded, re-home `5xi.1`'s
lifecycle-literal rule and `5xi.4`'s scanner strengthening, drop `5xi.3`, and delete the
plan file per ADR-0002.

## Open Questions

- **Does `check-no-mocked-api` split or stay whole?** A partial migration means two homes
  for one rule, which the repo's own `§0` discourages. Keeping it whole as a script means
  the highest-value prohibition gets the weakest feedback loop.
- **Flat config or legacy?** The repo has `eslint.config.js`, suggesting flat config
  already. Custom rules in flat config are straightforward but the plugin-authoring shape
  differs from the legacy documentation most examples use.

## Sources / Prior Decisions

- Plan 123 — Workflow Gate Hardening (`pool-master-5xi.2`, overlapping scope)
- Plan 136 — Test runner consolidation (determines the test-lint plugin)
- Plan 138 — Test traceability revisit (may retire one migration target)
