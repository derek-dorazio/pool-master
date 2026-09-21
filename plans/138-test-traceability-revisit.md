# Plan 138 — Test Traceability Revisit

**Tracking epic:** _not yet created_ — substrate depends on Plan 139.

## Purpose

Decide whether `testing-rules.md §1A` *Test Self-Documentation* — every test referencing a
use-case, business-rule, or defect ID — earns its cost, and reshape or retire it
accordingly.

## Triggering Findings

**The intent is right.** A test that does not say why it exists is hard to maintain and
easy to delete for the wrong reason. Nothing here argues against that.

**The mechanism couples the test suite to a doc tree designed to be deleted.** `§1A`
requires IDs drawn from `requirements/product-requirements/features/<feature>/use-cases.md`
and `business-rules.md`. Those are *feature-life* artifacts under `workflow-rules.md §0` —
retired or trimmed after a feature stabilizes. A permanent test suite referencing IDs in
impermanent documents accumulates dangling references by design.

**It is aspirational, not enforced.** `check-test-traceability` runs `--warn-only` against
an acknowledged repository-wide backlog. `§1A` says new slices "should reduce that count
rather than add to it," which is a direction of travel, not a gate.

**It imposes a documentation prerequisite on writing a test.** "If none exists, create or
update the product/business-rule artifact before expanding the test suite." That is a real
tax, and it lands hardest on exactly the small defect-fix slices where a test matters most.

**Its stated consumers are being retired.** `§1A`'s *Why* section says "Riley and Quinn
rely on these references to audit coverage." Plan 133 retires both.

## Key Decision — three options

**Option A — keep as-is.** Retains full auditability. Costs the doc-tree coupling, the
prerequisite tax, and a scanner that has never been enforced. Requires committing to keep
the requirements ID space current, which is harder once Pam retires.

**Option B — soften to intent-revealing test names (recommended).** Drop the formal ID
requirement. Require that a test name state the behavior and its expected outcome
specifically enough that a reader knows what breaking it means. Keep the ID requirement
for exactly one case: **defect-fix tests reference the defect ID**, which is both cheap
and genuinely valuable, since it links a regression test to the incident that motivated
it, and defect IDs live in the tracker rather than in a delete-on-ship doc.

This keeps roughly 80% of the benefit — tests explain themselves — at close to none of
the coupling cost. It also survives Plan 133 and Plan 139 unchanged.

**Option C — drop entirely.** Simplest, and loses the defect-to-test link that is the most
defensible part of the current rule.

**Recommendation: Option B.** The defect-ID half is load-bearing and cheap; the
use-case-ID half is expensive and coupled to documents that are supposed to disappear.

## Consequences by option

| | A | B | C |
|---|---|---|---|
| `check-test-traceability` scanner | Migrate to ESLint (Plan 135) and enforce | Narrow to defect-fix tests, or retire | Retire |
| Existing warn-only backlog | Must be cleaned | Mostly moot | Moot |
| `§1A` rule text | Unchanged | Rewritten, much shorter | Deleted |
| `§3` Defect Verification Protocol | Unchanged | Unchanged — keeps its traceability requirement | Loses its ID link |
| Slice completion checklist | Unchanged | One checkbox narrows | One checkbox removed |

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 133** retires Riley and Quinn, `§1A`'s stated consumers. Worth settling that plan
  first so this decision is made against the real roster.
- **Plan 135** — if traceability is retired or narrowed, the scanner migration target
  changes or disappears. Sequence this plan before the scanner migration to avoid building
  an ESLint rule that is then deleted.
- **Plans 136 and 137** also edit `testing-rules.md`. Sequence 136 → 137 → 138.

## Execution Sequence

Single decision slice, then a single edit slice. The decision is the work; the edit is
small under any option.

Under Option B, the edit touches `testing-rules.md §1A`, the `§11` *What Not To Do* entry
that references it, and the slice-completion checkbox in `workflow-rules.md §1`.

**Not in scope:** retrofitting or stripping IDs from existing tests. Under Option B
existing IDs stay valid and useful; they simply stop being required going forward.

## Open Questions

- **Does anything else depend on the UC/BR ID space?** `§6` *Required Use-Case Coverage
  Mapping* asks Tess and Quinn to point at where each use case is proven. That section
  needs its own disposition under Plan 133, and the answer may inform this one.
- **If Option B, is "specific enough" enforceable at all,** or is it a convention that
  lives or dies on habit? Probably the latter — which is acceptable for a rule whose
  enforcement was never real to begin with.

## Sources / Prior Decisions

- Plan 133 — Persona library to task-shaped skills (retires the stated consumers)
- Plan 135 — Rule scanners to ESLint (migration target depends on this outcome)
- Plan 136 — Test runner and layer consolidation (same file)
