# ADR 0006: GitHub Issues as the Live Task Tracker

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** ADR-0001 (Beads as the Live Task Tracker)

## Context

ADR-0001 chose Beads (`bd` CLI + a committed `.beads/issues.jsonl`) over GitHub Issues in
April 2026. Its reasoning was sound at the time: stable IDs, first-class epic→story
relationships, machine-readable export, local-first operation, and no API round-trip to read
task state. GitHub Issues was rejected as "heavyweight for slice-level work" with "weaker
tooling for parent/child semantics."

Five months of use changed three of the inputs to that decision.

**The committed tracker file is a merge-conflict generator.** Because `.beads/issues.jsonl`
is in git, every branch that touches task state conflicts with every other one.
`rules/workflow-rules.md §1` grew a ~50-line *rebase-and-resync* recipe — seven steps, a
`git diff | grep` verification incantation, and a standing warning never to hand-edit the
file — to manage a problem that exists only because task state is a committed artifact.

**The local-first property was weaker than it looked.** `bd` mutates a gitignored Dolt DB in
`.beads/embeddeddolt/`; the JSONL is a separate `bd export -o` step. Forget the export and
the committed state silently diverges from local truth. This was not hypothetical — the
final migration audit found a closed record still marked open in the committed JSONL.

**GitHub's parent/child semantics shipped.** Native sub-issues now cover the epic→slice
relationship that Beads was chosen for. Agents in this repo also have first-class GitHub
issue tooling available with nothing to install.

Separately, the review surface moved. Every PR is now read by the repo owner in the GitHub
UI, so keeping task state in a different system than the review is friction with no
compensating benefit.

## Decision

GitHub Issues is the canonical live task tracker for PoolMaster execution. Beads is removed:
the `bd` CLI dependency, the `.beads/` directory, and the JSONL conflict-resolution recipe
all go.

- Every active feature reorg or major effort maps to an **epic issue**.
- Every slice under that epic maps to a **sub-issue**.
- Status transitions happen on the issue as work starts and finishes.
- Scope changes, closeout notes, and handoff context live in **issue comments**.
- Slice commits carry `#NN` in the footer; the PR body carries `Closes #NN`.

**Only open and in-progress items were migrated** — 43 issues, covering 104 live Beads
records after epics were collapsed. The 439 closed records were not migrated: recreating them
would produce issues nobody reads, with wrong timestamps and no author fidelity. The 4
`deferred` records were not migrated either — deferred scope is a decision already made and
documented in the plan that dropped it, so an issue adds a second place to read it from. All
of it remains recoverable via `git show <sha>:.beads/issues.jsonl`, which is the same
delete-don't-archive stance ADR-0002 takes toward plans.

Plan files remain narrative companions and still carry no task tables. **ADR-0002 is
unaffected and is not edited** — its decision (plans are narrative; deleted when the parent
closes) holds unchanged; only the identity of the tracking item changes, from a Beads epic to
an issue number. ADR-0002's prose still says "Beads epic" because accepted ADRs record what
was decided when it was decided. The operational instruction lives in
`rules/workflow-rules.md §1`, which is where it gets updated.

## Consequences

**Positive**

- No committed tracker file, therefore no tracker merge conflicts, therefore no rebase-and-resync recipe.
- One state, not two. No export step to forget.
- Task state, code review, and CI live on one surface.
- PR↔issue linkage is native (closing keywords, the development sidebar) instead of `git log --grep`.
- No tool to install to read task state.

**Tradeoffs / new constraints**

- **Offline access is lost.** Beads worked on a plane; GitHub Issues does not. For a solo developer with network access this is small, but it is real.
- **Task state leaves the repo.** A clone no longer carries its own task history. The counter-argument is that it barely did — the JSONL was a snapshot that went stale whenever `bd` ran without an export.
- **Dependency modeling gets weaker.** Beads' `blocks` / `blocked_by` was first-class and queryable. Sub-issues model parent/child, not ordering, so dependencies become prose (`Blocked by #NN`) in the blocked issue's body. If ordering ever becomes load-bearing enough that prose stops working, the answer is a GitHub Project with a relationship field — **not** a return to a side-file tracker.
- **Historical `pool-master-<suffix>` IDs no longer resolve against a tool.** They stay valid as references into git history and are deliberately not rewritten in commit messages, test traceability comments, or `SKIP:` markers. Every migrated issue names its original Beads ID in its body, so the mapping is searchable.

## Alternatives considered

- **Stay on Beads and fix the conflict problem.** Rejected: the conflict is structural, not incidental — it follows from committing shared mutable state. The only fix is to stop committing it, at which point the local-first argument for Beads collapses.
- **Beads for slices, GitHub Issues for anything cross-cutting.** Rejected: two trackers is strictly worse than either one. The whole cost of ADR-0001's arrangement was having task state in a different place from the review.
- **Adopt a GitHub Project immediately.** Deferred, not rejected. Projects would restore queryable dependencies, at the cost of a second surface to maintain. Plain issues plus prose is the smaller step; the Project is available if dependency ordering proves load-bearing.
- **Migrate the closed history too.** Rejected: 439 issues nobody will read, with wrong timestamps and no author fidelity. Git history is the archive.
