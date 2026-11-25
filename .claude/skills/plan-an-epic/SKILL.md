---
name: plan-an-epic
description: Planning an epic that moves facts into the model — settle each fact's model home, generate the list of code that reads it, write each slice ticket as a checklist (scope, retires, readers, tests), register the retired names, then have the plan reviewed against the code, and re-map owners after every split. Use when writing or revising a plan and its slice tickets, before any review round of the plan.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Bash, Write]
---

# Planning an epic

A plan that moves facts into the model is two lists: each fact with its model home, and every
place in the code that reads the fact today. Plans here have been good at the first and have
skipped the second. Review rounds that read only the plan cannot find a missing reader, so the
second list is built before anyone reviews (`rules/workflow-rules.md` §1 *Grounding a plan in
code before it is reviewed*). The design rules are `rules/domain-model-conventions-rules.md`
§17 *Rules Live In The Model, Not In Code* and `rules/workflow-rules.md` §1 *One global
solution, never one sport's*.

## Step 1 — the facts and their homes

For each fact the epic touches, write one line: the fact, where it lives today (constant,
registry field, column, helper, web map) and its model home (a column on a definition,
reference rows set by migration, a provider mapping table, a field the API returns). Run the
`scan-hard-coded-rules` skill over the area first, so the list starts from the code rather
than from memory.

## Step 2 — generate the readers

For every name the plan retires, search; do not recall:

```bash
git grep -nw "<name>" -- packages clients/poolmaster tests scripts docs rules .claude \
  ':!**/migrations/**' ':!packages/shared/generated/**'
```

For a fact held under no single name (a year from the clock, a round found by position, a
web helper restating a server rule), use the matching search from `rules/review-triggers.md`
§9 *Reviewing for hard-coded rules*, and read the hits. Group the hits by the slice that will
own them. Every hit has exactly one owner, including tests, test builders, the test-data
loader, the browser journeys and docs.

## Step 3 — write each slice ticket as a checklist

Use the sections in `rules/workflow-rules.md` §1 *A slice ticket is a checklist*: Scope (with
the model home for each fact), Retires and Readers (the hits from step 2, pasted, not
summarised), Tests (the layers each scope line needs, from `rules/testing-rules.md` §2 *Each
slice names its layers*, plus query-count cases and failing tests first for defects), Blocked
by and Done when. A ticket that says only "see the plan, section N" is not written yet.

## Step 4 — register the retired names

Add each retired name to `scripts/retired-names.json` with its owner ticket under `$owners`
and its count from step 2, then run `node scripts/check-retired-names.mjs` to confirm the
count. A new entry is a new baseline key, so declare it in `scripts/baseline-raises.json` as
`{ file, key, now, reason }` with reason "retired by #N"; the ratchet refuses it otherwise,
and the reviewer sees the declaration in the diff. From then on `rules:check:retired-names` stops new
readers appearing while the slices are built. A new field or export in the sport registry is
never part of a plan: the registry is frozen (`rules/architecture-rules.md` §4 *Sport
extension*).

## Step 5 — review the plan against the code

Brief each reviewer with the plan, the tickets and the reader lists, and ask them to check the
lists against the code: a reader the list missed, a fact with no home, a hit with no owner or
two. A review that cites no code has not done the job; send it back. Reviewers write their
findings as proposed edits to the ticket bodies.

## Step 6 — fold, then re-map

Fold every agreed review finding into the ticket body. A comment that overrides the body is
the line an implementer misses. After any split or merge of tickets, run one pass that maps
every plan line and every reader hit to exactly one ticket, and fix the ones with none or
two.

## Traps

- **Naming the symbol, not its readers.** "The round-name arrays go in slice 9" leaves the six
  files that index them for the implementer to find. Paste the hits.
- **"Slices 7 and 8 delete X."** Two owners is no owner. Name one.
- **Splitting after review.** A split moves lines; the re-map in step 6 is what proves none
  fell out.
- **Tests as an afterthought.** A scope line with no named layer ships proven only by
  coverage floors, which cannot tell a query count or a journey from a covered line.
