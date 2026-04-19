## Purpose

Prepare PoolMaster to adopt Beads as the live execution-tracking layer while
preserving the repo's richer planning and specification artifacts.

This plan exists to support a clean transition after:

- moving the repo to a new folder on the local machine
- installing Beads
- rebooting and starting a fresh working session

## Scope

- define how Beads should fit into the current PoolMaster workflow
- preserve `plans/` as contextual design/execution documentation
- identify the first pilot lane for Beads adoption
- define the restart checklist for the next session

## Out Of Scope

- full repo-wide migration of all historical plans into Beads
- replacing `requirements/`, `tech-specs/`, or `plans/`
- immediate contest implementation work

## Locked Direction

- `requirements/` remains the product-input layer
- `tech-specs/` remains the technical-input layer
- `plans/` remains the narrative execution-context layer
- Beads should become the **live execution-state layer**
- Beads should replace detailed markdown task tracking over time, but not the
  richer design rationale stored in plans

## Proposed Workflow

### Artifact Hierarchy

1. `requirements/`
   - product truth and requirement handoff artifacts
2. `tech-specs/`
   - technical-spec truth and implementation handoff artifacts
3. `plans/`
   - purpose, scope, decisions, rationale, phased rollout notes
4. `Beads`
   - live execution graph
   - status
   - dependency chain
   - ownership
   - readiness
   - verification state

### Mapping Model

- one active plan lane -> one Beads epic
- one actionable plan row or sub-slice -> one bead
- dependencies should be expressed in Beads rather than only implied in plan
  prose

### Ownership Model

Suggested bead owners:

- `Pam`
- `Tom`
- `Dom`
- `Tess`
- `Archie`
- `Brad`
- `Fran`
- `Quinn`
- `Riley`

### Status Model

Recommended starting statuses:

- `backlog`
- `ready`
- `in_progress`
- `blocked`
- `done`

## Recommended First Pilot

Use the current contest lane as the first Beads pilot because it has:

- multi-role handoffs
- backend/frontend/test sequencing
- meaningful dependencies
- enough complexity to prove value without forcing a repo-wide migration

Suggested pilot epic:

- `golf-first-contest-config`

Example bead groupings:

- product requirements
- technical spec
- test matrix
- backend typed config work
- commissioner create/manage UI
- lifecycle UX
- team entry UI
- verification
- review

## Next-Session Restart Checklist

Before resuming in a new session:

1. Move the repo to the new filesystem location.
2. Install Beads on the machine.
3. Reopen the repo from the new location.
4. Confirm the repo still builds and tools resolve from the new path.
5. Review this plan first.
6. Decide whether to:
   - pilot Beads on the contest lane only, or
   - define a broader execution-tracking migration strategy

## Questions To Resolve In The Next Session

- Should Beads metadata live inside the repo or in user-local state?
- Should Beads adoption begin with contests only or also cover new feature
  lanes going forward?
- How much of the current plan task-table behavior should remain once the pilot
  starts?

## Current Session Findings

- As of 2026-04-19, Beads is installed locally via Homebrew and reports
  `bd version 1.0.2 (Homebrew)`.
- This repo is now initialized for Beads in repo-local embedded mode.
  `bd where` resolves to `/Users/DDorazio/development/Github-Personal/pool-master/.beads`
  with database path `.beads/embeddeddolt`.
- `bd init` creates a repo-local `.beads/` directory by default and supports:
  - embedded mode by default
  - `--server` for external Dolt server mode
  - `--stealth` for local-only usage hidden from collaborators
  - `--skip-agents` and `--skip-hooks` when we want a narrower pilot
- The repo-local pilot is now seeded with epic `pool-master-73j`
  (`Contest lane Beads pilot`).
- Current pilot child beads:
  - `pool-master-73j.1` — `Normalize contest entry launch CTA copy`
    - status: `closed`
  - `pool-master-73j.2` — `Track remaining contest entry UX cleanup`
    - status: `open`
  - `pool-master-73j.3` — `Review Beads workflow impact on plans task tables`
    - status: `open`

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 99-001 | 1 | Confirm Beads install/init workflow on the local machine after the repo move | Done | Confirmed on 2026-04-19: `bd version 1.0.2 (Homebrew)` is installed locally, the repo is not initialized yet, and `bd init` defaults to a repo-local `.beads/` embedded setup. |
| 99-002 | 1 | Decide where Beads state should live for this repo | Done | Selected repo-local embedded mode for the pilot and initialized `.beads/` with `bd init --non-interactive --role maintainer --skip-agents --skip-hooks`. |
| 99-003 | 2 | Define the PoolMaster Beads mapping from plan lane -> epic and plan row -> bead | Done | Created pilot epic `pool-master-73j` for the contest lane and seeded child beads for the current slice plus immediate follow-up work. |
| 99-004 | 2 | Pilot Beads on the current contest execution lane | In Progress | The pilot is live. `pool-master-73j.1` has already moved through `in_progress` to `closed` for the completed CTA-copy slice, while follow-up contest-entry work remains queued in `pool-master-73j.2` and `pool-master-73j.3`. |
| 99-005 | 3 | Review whether markdown task tables in active plans should be reduced once the pilot works | Not Started | Do not remove plan context; only reconsider duplicate task-status bookkeeping. |
