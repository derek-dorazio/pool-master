# Plan 139 — Beads to GitHub Issues

**Tracking epic:** _not yet created_ — this plan changes what that line means.

## Purpose

Replace Beads with GitHub Issues as the live task tracker, keeping `plans/` as the
narrative layer and Claude Code's plan mode and todo list for in-session sequencing.

ADR-0001 established Beads as the canonical task tracker. The reasoning was sound: task
state lives in the repo, greppable and readable without an API round-trip. This plan
revisits that decision against what it has cost and what has changed.

## Triggering Findings

**The tracker file is a merge-conflict generator.** `.beads/issues.jsonl` is committed, so
every parallel branch that touches task state conflicts with every other one.
`workflow-rules.md §1` carries a ~50-line *rebase-and-resync* recipe — seven steps, a
verification `git diff | grep` incantation, and a warning never to hand-edit the file — to
manage a problem that exists only because task state is a committed artifact.

**Dual state with a manual export step.** `bd` mutates a local Dolt DB in
`.beads/embeddeddolt/` (gitignored); the JSONL is a separate `bd export -o` step. Forget
the export and the committed state silently diverges from the local truth.

**The agent already has first-class GitHub tooling.** This session has
`mcp__github__issue_read`, `issue_write`, `sub_issue_write`, `list_issues`, and
`search_issues` available without installing anything.

**PR linkage is manual.** `workflow-rules.md §1` asks for the story ID in the commit
footer and the epic ID in the PR description, then relies on `git log --grep` to recover
the association. GitHub Issues gets this natively through closing keywords and the
development sidebar.

**The review surface is already GitHub.** Plan 132 puts the repo owner in the GitHub UI to
read every PR. Having task state in a different system than the review is friction with no
compensating benefit.

## Key Decisions

### 1. The three-layer split survives; only the bottom layer changes

| Layer | Now | After |
|---|---|---|
| Narrative for an in-flight effort | `plans/NN-*.md` | Unchanged |
| Live task state | `.beads/issues.jsonl` | GitHub Issues |
| In-session sequencing | — | Plan mode and the todo list |

ADR-0002 (plans are narrative, deleted when the parent closes) is unaffected. Plans
reference a tracking issue instead of a Beads epic.

### 2. Mapping

| Beads | GitHub |
|---|---|
| Epic | Issue, with child issues via native sub-issues |
| Child story | Sub-issue |
| `status: open / in_progress / closed` | Open / assigned / closed, or a Project status field |
| `deferred` | Closed with a `deferred` label and a closing comment |
| Labels (`layer/*`, `risk/*`, `blocked/*`) | Labels, carried over nearly as-is |
| Labels (`persona/*`) | **Dropped** — meaningless after Plan 133 |
| `blocks` / `blocked_by` | The weakest part of the mapping — see open questions |
| Story notes (starting, closing) | Issue comments |
| `pool-master-NNN` in commit footer | `#NNN`, with closing keywords in the PR body |

### 3. Do not migrate closed history

`.beads/issues.jsonl` currently holds 556 records: 439 closed, 4 deferred, 1 in progress,
112 open. Migrating the closed set creates 439 GitHub issues nobody will read, with wrong
timestamps and no author fidelity.

Migrate **the 113 open and in-progress items only** — a fifth of the file, and a tractable
one-pass job. The JSONL stays in git history, and `git show <sha>:.beads/issues.jsonl`
recovers any closed record. This mirrors ADR-0002's delete-don't-archive stance.

The 4 deferred items are a judgment call: they represent consciously dropped scope, so
they may be worth migrating as closed-with-`deferred`-label for visibility, or may be
better left in history.

### 4. What this deletes

- `.beads/` and the `bd` CLI dependency
- The rebase-and-resync recipe and the `bd` quick reference in `workflow-rules.md §1`
- The `Bash(bd *)` permission block in `.claude/settings.json` (~20 entries)
- `§5` *Finding Tasks*, which becomes "use `gh issue list` or the GitHub tools"

**ADR-0007 supersedes ADR-0001.** ADR-0001 is not edited — ADRs are immutable once
accepted; the new one records what changed and why.

### 5. Tracker reconciliation moves to a hook

`workflow-rules.md §1`'s *Beads Reconciliation Gate* is a checklist an agent must
remember. It becomes a `Stop` hook that checks whether an issue referenced in this
session's commits is still open, and surfaces it rather than relying on recall.

## Accepted Tradeoffs

**Offline access is lost.** Beads works on a plane; GitHub Issues does not. For a
solo developer with network access this is a small cost, but it is a real one and worth
naming rather than discovering.

**Task state leaves the repo.** A clone no longer carries its own task history. The
counter-argument is that it barely did — the JSONL is a snapshot that goes stale the moment
anyone runs `bd` without exporting.

**Dependency modeling gets weaker.** Beads' `blocks`/`blocked_by` is first-class and
queryable. GitHub's equivalent lives in Projects or in prose. See open questions.

## Data Model / API Surface Implications

None — this touches tooling and process only.

## Dependencies

**This plan is the ordering wildcard.** Every other plan in this set (132–138, 140) is
tracked by whatever the substrate is. Two defensible orders:

- **First:** the other plans are tracked in GitHub Issues from the start, no migration
  mid-flight, and Plan 134 deletes the rebase recipe rather than relocating it.
- **Last:** the migration does not happen while eight plans are in flight, at the cost of
  seeding Beads epics that are then migrated.

**Recommendation: first, or at least before 134.** The set of plans queued here is exactly
the kind of parallel work that generates the JSONL conflicts this plan removes.

- **Plan 134** — the rebase recipe's disposition depends on this. Relocating it to `docs/`
  and then deleting it is wasted motion.
- **Plan 133** — `persona/*` labels become meaningless; sequencing after it avoids
  migrating labels that are about to be dropped.

## Execution Sequence

**First — decide the ordering** relative to the rest of the plan set. Everything else here
is downstream of that call.

**Second — label taxonomy and issue templates.** Create the GitHub labels matching the
surviving Beads families, and an issue template carrying the fields the workflow expects.

**Third — migrate open items.** Export open and in-progress records, create issues and
sub-issues, verify counts, and map old IDs to new ones for reference from existing plan
files.

**Fourth — rewrite the rules.** `workflow-rules.md §1` and `§5`, the slice-completion
checklist, the commit-footer convention, and ADR-0007.

**Fifth — remove `.beads/` and the permission block, and add the `Stop` hook.**

## Open Questions

- **How are dependencies modeled?** GitHub Projects has relationship fields; plain Issues
  has prose and task lists. If `blocked_by` is load-bearing in practice, that argues for
  adopting Projects; if it was mostly documentation, prose is enough. Worth checking how
  many Beads dependencies actually exist before deciding.
- **Does a GitHub Project get adopted at all,** or are plain Issues plus labels sufficient?
  Projects adds capability and a second surface to maintain.
- **What happens to the `pool-master-NNN` IDs already embedded in commit messages, test
  traceability comments, and `SKIP:` markers?** They stay valid as historical references
  into the JSONL in git history, but they will not resolve against GitHub. The ID map from
  slice three is the mitigation; whether existing references get rewritten is a separate
  call, and probably not worth it.

## Sources / Prior Decisions

- ADR-0001 — Beads as live task tracker (superseded by this plan's ADR-0007)
- ADR-0002 — Plans are narrative; deleted after parent epic closes (unaffected)
- Plan 133 — Persona library to task-shaped skills (drops `persona/*` labels)
- Plan 134 — Rules consolidation (rebase recipe disposition)
