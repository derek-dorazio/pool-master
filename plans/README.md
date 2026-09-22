# Plans Overview

`plans/` holds **narrative companions** for work currently in flight. Each plan file maps to a parent epic issue in GitHub Issues and is deleted when that epic closes. See `rules/workflow-rules.md §0 Document Lifecycle` and `docs/adr/0002-plans-as-narrative-delete-after-epic-closes.md` for the governing rules.

## How this folder works

- Every active plan has a **Tracking issue** line in its header (e.g. `**Tracking issue:** #100`). The `Stop` hook flags a plan that has none.
- **Task state lives in GitHub Issues**, not in plans. Use `gh issue view <NN>` to see the live slice list, statuses, and closeout comments.
- Plan files contain **narrative only**: purpose, governing principles, scope, architecture / pattern narrative, site maps, tile→destination mappings, open questions, and backend contract questions.
- Plan files do **not** contain task tables or Done/Not Started status columns.

## When a plan dies

- When the parent epic issue closes (all sub-issues resolved), the plan file is **deleted** in the same commit or an immediately following cleanup commit.
- Before deletion, any durable patterns or decisions the plan introduced must be codified — in `rules/*.md`, as an ADR in `docs/adr/`, or as a code comment at the canonical implementation site. See `rules/workflow-rules.md §0` governing rule 7 for which layer fits.
- Git history preserves the deleted file. `git log -- plans/NN-*.md` and `git show <sha>:plans/NN-*.md` retrieve any prior version.
- This directory does **not** use an `archive/` subdirectory. Archive directories accumulate the same problem under a different path; deletion is the enforcement mechanism.

## Where things actually live

| Concept | Canonical home |
|---|---|
| Task status, slice list | GitHub Issues (`gh issue list`, `gh issue view <NN>`) |
| How we build here (conventions, checklists) | `rules/*.md` |
| Why we chose a durable approach | `docs/adr/*.md` |
| Product intent for a major feature | `requirements/product-requirements/features/<feature>/` |
| Pre-implementation technical spec for a major feature | `tech-specs/features/<feature>/` (deleted when implementation ships) |
| Narrative context for an in-flight major effort | `plans/NN-*.md` (deleted when the epic issue closes) |

## Currently active

Run `gh issue list` to see the open epics. Each plan file here links to its tracking issue.
