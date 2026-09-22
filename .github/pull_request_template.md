<!--
Filling in every section is part of the slice-completion checklist.
The repo owner reads this body plus the changeset before asking for a merge.
See rules/workflow-rules.md §6.
-->

## Slice intent

<!-- One paragraph: what this slice does and why, in product terms. Not "I changed these files." -->

## Tracker linkage

- **Parent epic:** `pool-master-<EPIC>`
- **Slice story:** `pool-master-<STORY>`

## Use-case / business-rule / defect IDs covered

<!-- The specific IDs the new tests reference per rules/testing-rules.md §1A. -->

- `UC-<ID>` — <one-line description>
- `BR-<ID>` — <one-line description>
- `pool-master-<DEFECT-ID>` — <description>   <!-- defect-fix slices only -->

## Defect-fix observation

<!--
Defect-fix slices ONLY. Delete this section for new-behavior slices.
Per rules/testing-rules.md §3, the slice must demonstrate the failing
test was observed to fail on the broken code BEFORE the fix landed.
-->

The failing test reproducing `pool-master-<DEFECT-ID>` was observed to fail
on the broken code before the fix landed. Evidence: <commit SHA / referenced line>.

## Gates run

<!-- Required local gates per rules/testing-rules.md §3. Check each. -->

- [ ] `npx turbo typecheck --force`
- [ ] `npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0`
- [ ] `npx jest --config tests/jest.config.js --forceExit`
- [ ] `npm run test:service:functional-api`
- [ ] `npm run test:poolmaster:unit`
- [ ] `npm run test:coverage:service:merged`
- [ ] `npm run api:refresh` / `npm run api:validate` (if API schemas changed)

## Review triggers

<!-- review:triggers -->
None.

<!--
Replace "None." with what this slice touched that warrants a closer read than
the file list gives. See rules/review-triggers.md for the list and the rule
that triggers are conditions, not surfaces.

Do NOT list anything a scanner already catches — self-reporting those is weaker
than the scanner. Cover judgement calls only: authorization boundaries, data
safety, performance risk, deviations from plan, and anything you considered and
deliberately did not fix.

Blast-radius disclosure is mandatory, not optional: destructive migrations,
data backfills, and non-reversible production effects must be stated here with
what they touch and whether rollback is possible.

The marker line above (the review:triggers HTML comment) MUST remain in the PR
body — CI greps every PR for it via npm run rules:check:pr-review-triggers.
-->

## Merge

<!--
The agent does not merge on its own initiative. Open the PR, report, and stop.
The repo owner reads the changeset and asks for the merge when ready.
-->
