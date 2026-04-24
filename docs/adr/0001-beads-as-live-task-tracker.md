# ADR 0001: Beads as the Live Task Tracker

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

PoolMaster execution is slice-based: a feature reorganization or major effort is broken into small, independently shippable slices that each map to a commit and pass a repo-wide gate set. Tracking those slices reliably — their status, dependencies, notes, and the epic they roll up to — is load-bearing for the workflow.

Candidate trackers considered:

- **Markdown task tables inside plan files.** Natural for narrative, but status drifts silently between table cells and reality. Multiple slices touching the same plan file compete on edits. Task lists duplicate across 101+ plan files with no enforced consistency.
- **GitHub Issues.** Heavyweight for slice-level work; poor fit for offline / machine-readable tooling; coupling to GitHub for local-only development is friction.
- **Beads** (`bd` CLI + `.beads/issues.jsonl`). Stable issue IDs, parent/child relationships (epics → stories), labels, dependencies, notes, status transitions, JSONL export for machine consumption, local-first. Purpose-built for slice-oriented execution.

## Decision

Beads is the canonical live task tracker for PoolMaster execution.

- Every active feature reorg or major effort maps to a **Beads epic**.
- Every slice under that epic maps to a **Beads child story**.
- Status transitions (`open` → `in_progress` → `closed` / `deferred`) happen in Beads at the moment the work starts or finishes.
- Scope changes, closeout notes, and handoff context live in the Beads story notes field.
- `.beads/issues.jsonl` is the committed, machine-readable export of the tracker state.

Plan files (`plans/NN-*.md`) become narrative companions to their Beads epic — they carry scope, architecture, site maps, open questions, but **no task tables**. See ADR-0002.

## Consequences

**Positive**

- Task status never drifts. There is one place to look.
- Parent/child relationships support richer queries than static markdown tables.
- Agents (human and AI) use the `bd` CLI uniformly; no hand-edited markdown tables to reconcile.
- Closed-epic cleanup is deterministic (see ADR-0002).

**Tradeoffs / new constraints**

- Requires the `bd` CLI to be installed locally to inspect task state.
- Slice authors must discipline themselves to update Beads state at slice start and end (encoded in `rules/workflow-rules.md §1 Slice Completion Checklist`).
- Beads state changes are per-operation; concurrent agents must be careful to reconcile their own updates without clobbering others'.

## Alternatives considered

- **Plan task tables (status quo before this ADR).** Rejected: silent drift, merge conflicts, duplication across files. The exact problem Beads was introduced to solve.
- **GitHub Issues.** Rejected: heavy for local-first slice execution; weaker tooling for parent/child semantics; externalizes tracker state that belongs local to the repo.
