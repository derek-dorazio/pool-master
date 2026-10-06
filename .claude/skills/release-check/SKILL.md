---
name: release-check
description: The gate set before a push or PR, and what to do when a gate fails. Use before pushing, when CI is red, or when deciding whether a slice is actually done.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash]
---

# Gates, and what a failure means

`rules/workflow-rules.md` §3 *Required Local Validation Before Push* is the one gate list.
Run every command on it locally before pushing — CI is a backstop, not the first run. Read
the list there each time rather than from memory or from a copy: this skill used to carry
its own six-command version, and it had silently dropped four of them.

Use `npm run lint` rather than a hand-written `eslint` glob. The glob has changed twice and
a copied one goes stale silently — which is exactly how a rule ends up enforced over fewer
files than anyone believes.

In an agent session, reset the disposable test database with `npm run db:test:migrate`, not
`db:test:reset` or a `:fresh` script — Prisma refuses `migrate reset` non-interactively.
`rules/testing-rules.md` §3 *Required Local Quality Gates* has the rest of what a
DB-backed failure means.

## When a gate fails

**The order matters.** Fix the production behavior first; only then adjust tests.

- **A test fails** → the default assumption is that the code is wrong, not the test. The
  three legitimate conclusions are: the production code has a real defect (fix it), the test
  asserts something the contract does not require (fix the test), or the behavior is not
  exercisable at this layer (move the test). *"Modify production code to make the test
  pass"* is never one of them — `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*.
- **A rule scanner fails** → read the section it names. The scanner output *is* the routing
  hint.
- **Lint fails** → no warn tier exists, so there is no "I'll fix it later" state. A rule at
  0 findings stays at 0.
- **Typecheck passes but ts-jest fails** → the package tsconfigs and the ts-jest config
  resolve types differently, so `turbo typecheck` passing is not proof that the backend
  suite compiles. A cast that looks redundant under one can be load-bearing under the
  other, failing with `TS2589` (excessively deep type instantiation). `packages/shared/dto/`
  carries one such cast with the reason written above it — when a cast has a comment
  explaining why it exists, verify by running the suite before removing it, not by
  re-reading the types.

## "Flake" is a diagnosis, not a default

A re-run is justified when a job died before any test body ran, or when it passed on this
exact commit earlier. Otherwise a failure is real. Never skip, disable, or quarantine a test
to get green — `rules/testing-rules.md` §1C *Test-Disable Discipline*, which permits no skip at all.

## Done is more than green

A slice is not done because CI passed:

- The GitHub issue is reconciled — closed, deferred with a label, or left open with a
  blocker stated (`rules/workflow-rules.md` §1 *Plans and the Issue Tracker* → Slice Completion Checklist).
- Docs that the change invalidated are updated **in the same PR**, not a follow-up.
- The PR discloses what `rules/review-triggers.md` requires: judgement calls, deviations
  from plan, blast radius, and anything you considered and deliberately did not fix.
