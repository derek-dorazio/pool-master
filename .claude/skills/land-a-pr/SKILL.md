---
name: land-a-pr
description: Merging an approved, green PoolMaster pull request safely — trial-merge main, settle generated files and migration timestamps, re-run the gates main's merge could break, squash-merge with the right closing keywords, close out the issue, and restart the branch from main. Use when a PR has its approval and the go to merge.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Bash]
---

# Landing a pull request

A PR that was green when it was reviewed can still break main: main has moved since, and two
green branches can be red together. Most red main runs here came from a merge, not from a
PR's own diff. This skill is the merge, done so that main stays green. The merge policy itself
is `rules/workflow-rules.md` §6 *Branching, Review, and Merge Cadence*; read *Slice closeout
protocol* and *Slices in a series* there.

## Step 0 — the go

Merge only with the approval and the go to merge the project's process gives
(`rules/workflow-rules.md` §6: the agent does not merge on its own initiative), and with CI
green on the PR's latest commit. A push after the approval needs CI green again; a push that
changed code needs the reviewer to look again.

## Step 1 — trial-merge main

Fetch main and merge it into the PR's branch locally. Then, before anything is pushed:

- **Generated files** (`packages/shared/generated/`): never hand-merge them. Take either side,
  run `npm run api:refresh` on the merged tree, and commit what it writes.
- **Migrations**: every migration this branch adds must sort after main's latest, and share no
  timestamp with any other. Rename only the branch's own, unapplied migration, never one main
  has shipped (`npm run rules:check:migration-timestamps`, after fetching main).
- **Code conflicts**: resolve them for both sides' intent. A resolution that changed code is
  new code nobody reviewed: say so to the reviewer before merging.

## Step 2 — re-run what main's merge can break

On the merged tree, at least `npm run lint`, `npx turbo typecheck --force`, `npm run
rules:check`, `npm run api:check` and `npm run typecheck:tests`; if main brought a migration or
changed code the branch touches, the whole gate set (`rules/workflow-rules.md` §3 *Required
Local Validation Before Push*). Lint reads the whole program, so a rule can fail on the merge
while passing on both sides. If the merge changed anything, push it and wait for CI.

## Step 3 — squash-merge

- **The title** is the PR's title with its number in parentheses, as `git log` on main reads.
- **The body** keeps a closing keyword for each slice issue the PR finishes, and none for an
  epic: a closing keyword in the squash message closes whatever it names, an epic with open
  children included. Name an epic with "Part of" instead.
- **Two merges close together are fine, three are not** (*Slices in a series*): before merging,
  check how many merges main's current run already holds.

## Step 4 — close out

1. Add the closing comment to each issue the merge closed: what shipped, and anything
   deliberately left out with its follow-up issue (`rules/workflow-rules.md` §1 *Slice
   Completion Checklist (Required Before Marking Done)*).
2. Watch main's run that the merge started. A red one is yours until shown otherwise (the
   `fix-broken-ci` skill).
3. The remote branch is deleted on merge. The next piece of work on the same branch name
   starts from main again; never add commits on top of a merged branch's history.

## Where this goes wrong

- **Merging the green PR without the trial merge.** Two branches each adding a migration with
  the same timestamp, or each regenerating the API, are green alone and red together.
- **Resolving a generated-file conflict by hand.** It passes review and fails `api:check`.
- **"Closes" for the epic.** The epic closes with work still open under it.
- **Reusing a merged branch.** Its next PR carries history that is already on main.
