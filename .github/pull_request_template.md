<!--
Filling in every section is part of the slice-completion checklist.
The repo owner reads this body plus the changeset before asking for a merge.
See rules/workflow-rules.md §6.
-->

## Slice intent

<!-- One paragraph: what this slice does and why, in product terms. Not "I changed these files." -->

## Tracker linkage

- **Parent epic:** #<EPIC>
- **Slice issue:** Closes #<ISSUE>

## Behaviour covered by new tests

<!-- Name the behaviour each new test proves, per rules/testing-rules.md §1A. No ID is required. -->

- <behaviour and expected outcome>

## Defect-fix observation

<!--
Defect-fix slices ONLY. Delete this section for new-behavior slices.
Per rules/testing-rules.md §3, the slice must demonstrate the failing
test was observed to fail on the broken code BEFORE the fix landed.
-->

The failing test reproducing #<DEFECT-ISSUE> was observed to fail
on the broken code before the fix landed. Evidence: <commit SHA / referenced line>.

## Gates run

<!-- The gate list lives once, in rules/workflow-rules.md §3. It is not copied here because copies drift. -->

- [ ] Every gate in `rules/workflow-rules.md` §3 *Required Local Validation Before Push* passed locally
- [ ] Any gate not run is named below, with the reason

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

Keep the marker line above (the review:triggers HTML comment) in the PR body.
CI greps every PR for it via npm run rules:check:pr-review-triggers, which
warns if it is missing and does not fail the build (#284). The section is worth
writing because it is read, not because CI would otherwise stop the merge.
-->

## Merge

<!--
The agent does not merge on its own initiative. Open the PR, report, and stop.
The repo owner reads the changeset and asks for the merge when ready.
-->
