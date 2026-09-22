# Plan 141 — Plan Directory Reconciliation

**Tracking issue:** #139

## Purpose

Reconcile `plans/` against the tracker: delete plans whose epics have closed, per ADR-0002,
after verifying their durable content has been codified somewhere permanent.

**Most of this plan has now been executed** on `main` (see *Status*). What remains is three
specific items and the root-cause fix that stops the backlog recurring.

## Reading the tracker correctly

**A plan's parent may be a nested ID, and a naive scan will silently truncate it.**

This plan's original scan matched `pool-master-[A-Za-z0-9]+`, which has no `.` in the
character class. Given a header declaring `pool-master-rop.78` it returned
`pool-master-rop` — a real but *different* epic — and reported plan 117 as belonging to an
open epic with 51 open children. `rop.78` was closed with all 13 of its own children closed;
`pool-master-rop` is the broader "Cross-stack code & architecture review" epic, of which
`rop.78` is one child among thirteen.

The same truncation hit plan 121 (`pool-master-eux.7` → `pool-master-eux`). That one was
caught by reading the file, noted as a curiosity, and the scan was never fixed — so the bug
produced a second wrong answer immediately afterward.

**Use a pattern that captures dotted IDs:**

```
pool-master-[A-Za-z0-9]+(?:\.[0-9]+)*
```

And treat the scan as a *shortlist generator*, never as the decision. Open the plan's
header and read the declared epic before acting on any deletion. A tracker ID that looks
like an epic may be a story, and an epic that looks open may be a different epic entirely.

The broader lesson: noting a tool's defect is not fixing it. A one-off correction to one
result leaves the instrument free to produce the same error on the next input.

## Status

**Complete — eight plans deleted after codification, one after verification:**

| Plan | Epic | Landed in |
|---|---|---|
| 104, 112 | `lpo`, `gs4` | `5cc824c` — patterns already in code, nothing to codify |
| 102 | `hwt` | `b6c4087` — ADR for cross-tier log correlation + code comments |
| 107 | `784` | `67acca5` — IA patterns split between `rules/` and product requirements |
| 119, 121 | `eux`, `eux.7` | `c2808f3` — integration-adapter boundary codified |
| 124 | `476` | `d4d665a` — durable patterns codified |
| 131 | `m32` | `511d8b2` — rationale already in `nullable-to-3-1.ts` comment |
| 117 | `rop.78` | `c019196` — epic closed, all 13 children closed |

Also `a88cc4c` added staleness banners to the four
`tech-specs/features/contest-event-feed-integration/` files (epic `33l` still open, so the
spec stays under ADR-0003), and `0682eea` closed stale bead records folded into shipped
`rop.78` slices.

**Remaining scope** is decisions 1–3 below.

## Key Decisions

### 1. Plan 111 waits on the persona-layout ADR

`pool-master-7p5` is closed with no open children, so `plans/111-persona-library-restructure.md`
is deletable on the tracker's terms. **Do not delete it yet.**

Plan 133 cites 111 as the source of the thin-pointer persona pattern it reverses, and
ADR-0002 requires durable reasoning be codified before deletion. That reasoning's permanent
home is Plan 133's single-tool persona layout ADR, which does not exist yet. Deleting 111
first orphans the rationale at exactly the moment Plan 133 needs it.

111's deletion rides with that ADR, in Plan 133's final slice — not in a general sweep.

### 2. ~~Resolve the Plan 122 contradiction~~ — done

`pool-master-q68` was **open with 4 open children**, while `plans/124 §1` and `plans/125 §4`
both recorded that Plan 122 had been dropped — the admin-authored tournament model removed
its premise (provider-corrected results arriving after completion). The tracker was never
updated.

That blocked Plan 125, whose `§3.3a` deletes the `EVENTRESULTS` feed *specifically because*
122 — its only stated consumer — is gone.

**Resolved before the tracker migration**, in the order ADR-0002's invariant requires
(*tracker closes → plan file deleted*): `q68` and its four children were closed as
`deferred`, then `plans/122` was deleted. Deleting first would have left four open children
referencing a file that no longer existed, which is worse drift than the original mismatch.

All five records are among the 9 `deferred` ones left in git history rather than migrated —
`git show <sha>:.beads/issues.jsonl | grep q68` recovers them.

### 3. ~~Plan 125 needs a tracker item~~ — done

`plans/125-sync-flow-deprecation.md` had no tracker item at all. Its dependency (124)
shipped 2026-09-03 and its deletion targets are all still present, so it was a ready-to-run
plan that was never opened — not a stale one.

**Delivered with the tracker migration:** epic #122 with sub-issues #123–#131. Both
corrections landed too — its `§5 Slice sequence` table moved into the epic, and its `§4`
reference to Plan 123 now says what is actually true (Plan 135 supersedes most of 123; what
survives is #86).

### 4. ~~Fix the root cause~~ — done, with one caveat

Nine plans accumulated because deletion is a manual checklist step nobody ran after an epic
closed. Cleaning up without addressing that means doing this again.

**Delivered with the tracker migration:** `.claude/hooks/check-tracker-reconciliation.mjs`,
registered as a `Stop` hook. It reports a plan whose tracking issue is closed, a plan that
declares no tracking issue at all, and an issue referenced by the branch's commits that is
still open. It reports; it never deletes — as the 117 episode showed, the scan's output is a
shortlist for a human or agent to verify, not a decision.

**Caveat:** the hook reads a `**Tracking issue:** #NN` line from a plan's first 15 lines.
That anchors on a declaration rather than on the first ID anywhere in the header, which is
the fix the *Reading the tracker correctly* section above calls for. The section's own
guidance still describes the looser scan and should be tightened to match the hook before
anyone runs the scan by hand again.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 133** owns Plan 111's deletion via its persona-layout ADR slice.
- **Plan 135** owns Plan 123's disposition; `5xi` stays open until then.
- ~~**Plan 139** determines the tracker substrate for decision 3 and hosts the drift check.~~ Landed — see `docs/adr/0006-github-issues-as-live-task-tracker.md`.

## Execution Sequence

~~**First — resolve 122.**~~ Done before the migration: `q68` and its four children are
closed as deferred, and `plans/122` is deleted.

~~**Second — open 125's tracker item.**~~ Done: #122.

~~**Third — add the drift check.**~~ Done: the `Stop` hook.

**One deletion is done.** `plans/132` was deleted once its last outstanding slice — a
PreToolUse hook requiring the review-triggers section — was dropped by decision rather than
left open (#145). The reasoning is codified in `rules/review-triggers.md §4`, which is what
ADR-0002 requires before a plan file goes.

**Two candidates remain, neither deletable today.** Each is blocked on a different thing,
and ADR-0002's invariant — *tracker closes → plan file deleted*, never the reverse — is what
makes each blocker binding rather than advisory:

| Plan | Blocked on | Why |
|---|---|---|
| `plans/111` | #132 (Plan 133) | Decision 1 above. Plan 133 cites 111 as the source of the thin-pointer pattern it reverses; 111's deletion rides with 133's persona-layout ADR, not a general sweep. |
| `plans/123` | #82 | Its tracking issue is **open**, with two open sub-issues (#86, #87). Plan 135 owns the disposition; `5xi` stays open until then. |

Both remaining blockers are real dependencies rather than a stall, and the drift this plan
exists to prevent is now reported automatically by the `Stop` hook on every session stop
rather than discovered months later.

**Also left:** tightening the *Reading the tracker correctly* section per the caveat in
decision 4 — it still describes the looser scan while the hook anchors on the
`**Tracking issue:**` declaration line.

## Open Questions

- **Does the drift check belong in CI as well as the hook?** The hook catches it at session
  end for whoever is working; CI catches it for everyone, including direct pushes. The
  direct-push lane covers plan housekeeping, which is exactly where this drift originates —
  arguing for CI. (It no longer covers tracker state: that left the repo with ADR-0006.)

## Sources / Prior Decisions

- ADR-0002 — Plans are narrative; deleted after the parent epic closes (the rule enforced here)
- ADR-0003 — Tech specs are pre-implementation only (why the `33l` spec stays, banner or not)
- Plan 133 — owns 111's deletion
- Plan 135 — owns 123's disposition
- ADR-0006 — GitHub Issues as the live task tracker (the substrate; supersedes ADR-0001)
