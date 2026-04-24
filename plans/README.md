# Plans Overview

`plans/` holds **narrative companions** for work currently in flight. Each plan file maps to a parent Beads epic and is deleted when that epic closes. See `rules/workflow-rules.md §0 Document Lifecycle` and `docs/adr/0002-plans-as-narrative-delete-after-epic-closes.md` for the governing rules.

## How this folder works

- Every active plan has a **Beads epic reference** in its header (e.g. `pool-master-784` for Plan 107).
- **Task state lives in Beads**, not in plans. Use `bd show <epic-id>` to see the live slice list, statuses, dependencies, and closeout notes.
- Plan files contain **narrative only**: purpose, governing principles, scope, architecture / pattern narrative, site maps, tile→destination mappings, open questions, and backend contract questions.
- Plan files do **not** contain task tables or Done/Not Started status columns.

## When a plan dies

- When the parent Beads epic closes (all child stories resolved), the plan file is **deleted** in the same commit or an immediately following cleanup commit.
- Before deletion, any durable patterns or decisions the plan introduced must be codified in `rules/*.md` or as an ADR in `docs/adr/`.
- Git history preserves the deleted file. `git log -- plans/NN-*.md` and `git show <sha>:plans/NN-*.md` retrieve any prior version.
- This directory does **not** use an `archive/` subdirectory. Archive directories accumulate the same problem under a different path; deletion is the enforcement mechanism.

## Where things actually live

| Concept | Canonical home |
|---|---|
| Task status, dependencies, slice list | `.beads/issues.jsonl` (live tracker; use `bd show`, `bd list`) |
| How we build here (conventions, checklists) | `rules/*.md` |
| Why we chose a durable approach | `docs/adr/*.md` |
| Product intent for a major feature | `requirements/product-requirements/features/<feature>/` |
| Pre-implementation technical spec for a major feature | `tech-specs/features/<feature>/` (deleted when implementation ships) |
| Narrative context for an in-flight major effort | `plans/NN-*.md` (deleted when Beads epic closes) |

## Currently active

Run `bd list` to see the open epics. Each plan file here links to its parent epic.
