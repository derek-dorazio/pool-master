---
paths:
  - "tests/**"
  - "**/*.test.{ts,tsx,mjs}"
  - "**/*.spec.{ts,tsx}"
  - "clients/poolmaster/src/test/**"
---

# Tests — the Non-Negotiables

You are editing a test. Each line cites its one canonical statement, which wins if this
summary ever disagrees.

- **A defect fix starts with a test that fails on the broken code**, then passes on the fix.
  `rules/testing-rules.md` §3 *Defect Verification Protocol*.
- **Name the behaviour and its expected outcome** so a reader knows what breaking it would
  mean. No issue or use-case ID is required. `rules/testing-rules.md` §1A *Test
  Self-Documentation*.
- **Never skip, disable or quarantine a test**; there is no exempting comment. Fix it, or
  delete it and record the coverage gap. `rules/testing-rules.md` §1C *Test-Disable
  Discipline*.
- **Mocks, fakes and fixtures live in test code only**, and use the generated contract
  shapes. `rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*.
- **The gate list before a push** is `rules/workflow-rules.md` §3 *Required Local
  Validation Before Push*. Focused runs are additive; they never replace it.
