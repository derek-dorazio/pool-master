# ADR 0002: Plans Are Narrative; Deleted When The Parent Beads Epic Closes

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Plans (`plans/NN-*.md`) historically served two purposes:

1. **Narrative execution context** for a major effort — scope, architecture, rationale, site maps, tile mappings, open questions.
2. **Task tracker** — a markdown task table with slice IDs, status columns, notes per slice.

Mixing these two responsibilities produced two compounding problems:

- **Status drift.** Slice status lived in two places (plan table + Beads). Reconciliation was manual and often skipped; the two layers disagreed silently.
- **Accumulation.** 100+ plan files accumulated in `plans/` with no archival discipline. Agents scanning the directory had to sift stale completed plans from live ones. Attempts to add a `plans/archive/` rule failed because files in the tree get read regardless of rule text.

Adopting Beads as the canonical task tracker (ADR-0001) resolves the status-drift problem at its root — Beads owns task state. That leaves one question: what is a plan file for, and when does it leave the working tree?

## Decision

Plan files are **narrative-only** companions to a Beads epic, and are **deleted** when the parent epic closes.

- Every active plan file has a parent Beads epic. The plan file header references the epic ID. The epic references the plan file in its description or notes.
- Plans contain: purpose, governing principles, scope, architecture/pattern narrative, site map, tile-to-destination mapping, open questions, backend-contract questions. Plans do **not** contain task tables or status columns.
- When the parent Beads epic closes (all child stories resolved), the plan file is deleted in the same commit or an immediately following cleanup commit.
- Before deletion, verify that any durable patterns or decisions the plan established have been codified in `rules/` or in an ADR. A plan that introduced a new convention without updating those layers is not ready for deletion.
- Git history preserves the deleted file. `git log -- plans/NN-*.md` and `git show <sha>:plans/NN-*.md` retrieve any prior version.

**Archives are not used.** `plans/archive/` is explicitly rejected — archive directories accumulate the same problem under a different path, and agents/humans read files they can see regardless of "don't read this" rules.

## Consequences

**Positive**

- `plans/` directory stays small and current. New agents and contributors see only what's actually in flight.
- Task-status drift eliminated — Beads is the single source of truth.
- Deletion enforces that durable knowledge *leaves* the plan before the plan dies, pushing patterns into `rules/` and decisions into ADRs where they belong long-term.
- Git history is always available for retrieval; nothing is lost.

**Tradeoffs / new constraints**

- Deletion discipline must be enforced: closing an epic without deleting its plan is a drift bug.
- Contributors must accept that the working tree is not the historical record. `git log` is.
- Before deleting a plan, a capture pass is required — this is genuine work, not zero-cost.

## Alternatives considered

- **Keep task tables in plans alongside Beads.** Rejected: silent status drift, documented in ADR-0001.
- **`plans/archive/` directory for completed plans.** Rejected: archive directories get read; the problem is not solved by moving files to a differently-named folder.
- **Leave completed plans in place indefinitely.** Rejected: this is the current state; it's the problem this ADR solves.
