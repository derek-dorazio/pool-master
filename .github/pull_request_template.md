<!--
This PR template mirrors the Riley spawn prompt in rules/workflow-rules.md §6.
Filling in every section is part of the slice-completion checklist —
Riley reads this body when reviewing.
-->

## Slice intent

<!-- One paragraph: what this slice does and why, in product terms. Not "I changed these files." -->

## Beads linkage

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

## Known concerns

<!--
Anything you noticed but consciously chose not to fix in this slice
(and why), or anything you're uncertain about. Naming concerns up
front prevents Riley from "discovering" them as findings.
Write "None" if there are none.
-->

## Riley findings

<!-- riley:findings -->
Pending Riley review.

<!--
Replace "Pending Riley review." above with the findings table once Riley
has reviewed. Use "No findings." if Riley reported zero. The literal HTML
comment `<!-- riley:findings -->` MUST remain in the PR body — CI greps
every PR for it via `npm run rules:check:pr-riley-marker` and will fail
the build if it is missing. See rules/workflow-rules.md §6 and
personas/riley.md.
-->

## Riley auto-merge gate

This PR will be auto-merged if Riley returns zero CRITICAL or HIGH findings.
Any blocker-severity finding pauses the merge for user review.

Special pause conditions (always require user approval, regardless of Riley):

- [ ] Slice contains a destructive migration, data backfill, or non-reversible production effect → **paused**
- [ ] Slice changes shared contracts (DTOs, OpenAPI, generated SDK exports) → **paused**
- [ ] Slice changes infrastructure, CI/CD, deployment, or auth boundaries → **paused**
- [ ] Slice deletes a plan file or retires a feature surface → **paused**
- [ ] Slice modifies `rules/`, `docs/adr/`, or `personas/` → **paused**
