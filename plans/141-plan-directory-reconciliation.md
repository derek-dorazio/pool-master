# Plan 141 — Plan Directory Reconciliation

**Tracking epic:** _not yet created_ — substrate depends on Plan 139.

## Purpose

Reconcile `plans/` against the tracker. Nine plan files have closed tracker items and
should have been deleted under ADR-0002; two more have status that contradicts what other
plans assert about them.

This is not a bulk `rm`. ADR-0002 requires that durable patterns a plan introduced be
codified in `rules/` or `docs/adr/` **before** the plan is deleted. The verification is the
work; the deletion is the easy part.

## Triggering Findings

Extracting each plan's tracker reference and checking it against `.beads/issues.jsonl`:

**Closed item, plan still present — delete after the ADR-0002 check:**

| Plan | Item | Tracker state |
|---|---|---|
| 102 webapp-logging-observability | `hwt` | closed, 7/7 children closed |
| 104 ingestion-config-persistence | `lpo` | closed |
| 107 webapp-navigation-reorganization | `784` | closed, 8/8 children closed |
| 112 ses-system-email-integration | `gs4` | closed |
| 119 golf-live-scoring-readiness | `eux` | closed, 8/8 children closed |
| 121 mock-provider-golf-live-contract | `eux.7` | closed 2026-05-31 |
| 124 golf-admin-tournament-management | `476` | closed 2026-09-03, "all steps complete" |
| 131 hey-api-nullable-generation-fix | `m32` | closed |

**Handled elsewhere, listed so the accounting is complete:**

| Plan | Disposition |
|---|---|
| 111 persona-library-restructure | `7p5` closed, but deletion **must ride with Plan 133's ADR slice** — see *Sequencing trap* |
| 123 workflow-gate-hardening | Open, but fully dispositioned by Plan 135 slice four |

**Contradictions to resolve:**

| Plan | Problem |
|---|---|
| 125 sync-flow-deprecation | No tracker item at all — "Draft for user review. No Beads epic opened yet." Its dependency (124) shipped; its targets are intact. This is drift-to-**track**, not drift-to-delete. See decision 2. |
| 122 golf-official-results-finalization | `q68` **open** with 4 open children, but Plans 124 §1 and 125 §4 both state it is **dropped**. The tracker and the plans disagree. |

**121 is a story-level plan, not an epic-level one.** Its header anchors to
`pool-master-eux.7`, a child of 119's epic. Deletable on its own merits; noted because a
naive scan reads it as a duplicate reference to `eux`.

## Key Decisions

### 1. Each deletion is gated on an ADR-0002 codification check

For each of the eight plans, before deleting: does the plan introduce a durable pattern,
convention, or boundary that is *not* already captured in `rules/` or `docs/adr/`?

- **Yes** → codify it first, in the same slice. Deleting a plan that introduced
  uncaptured guidance is how conventions get silently lost.
- **No** → delete.

Two are worth particular attention:

- **124** is the largest, most recently landed, and the one whose patterns are most likely
  to be load-bearing for future golf work — the admin-authoring model, score-linking,
  lane separation, the bulk-upload panel shape. Several of these read like ADR material.
- **119 and 121** together define the mock-provider live-scoring contract boundary. That
  boundary outlives both plans.

### 2. Plan 125 gets a tracker item, not deletion

Verified before recommending:

- **Its dependency shipped.** `pool-master-476` closed 2026-09-03 with "all steps
  complete," and 124's symbols are live in the tree — `adminListProviderCatalogEvents`
  (12 files), `golf-field-service` (4), `applySportEventStatusTransition` (7),
  `adminApplyGolfRoundScores` (8), `BulkUploadPanel` (8).
- **Its targets are untouched.** `runScheduleSync`, `ParticipantRankingSnapshot`,
  `getEventResults`, and `EVENTSCHEDULE` all still exist. No part of the deprecation has
  been done.

So 125 is a ready-to-execute plan that was never opened, not a stale one. It is also the
most rigorously prepared plan in the directory — it verified caller counts before
proposing deletions, records reversals of its own earlier drafts with the reasoning, and
carries a file-by-file test inventory including an explicit "zero findings, explicitly
checked, not just omitted" section.

**Open its tracker item now, in Beads, rather than waiting for Plan 139.** 125 is product
work and independent of the entire 132–141 workflow effort — it can start before any of
it, which is precisely why leaving it untracked risks it being forgotten. One more item
among 113 costs nothing at migration time, since that migration is a single batch pass.

The opposite call applies to Plans 132–141 themselves: Plan 139 sits inside that set and
its first job is choosing the substrate. Creating ten Beads epics and migrating them days
later is churn. Those stay untracked until 139 resolves.

Two corrections when 125's item opens:

- Its `§5 Slice sequence` table is task state in a plan file, against ADR-0002. It was
  written as a pre-epic draft, so this is forgivable — but those rows move to the tracker
  and the table comes out when the item opens.
- Its `§4` says "plans/123 (workflow gate hardening): unaffected; its shared-enum work is
  orthogonal." Plan 135 now supersedes most of 123. Minor cross-reference touch-up.

### 3. Resolve the 122 contradiction before 125 runs

This is a prerequisite, not a parallel task. Plan 125 §3.3a deletes the `EVENTRESULTS`
feed **specifically because** Plan 122 — its only stated consumer — is dropped. If 122 is
in fact still live, that deletion removes something a live plan depends on.

The evidence says 122 really is dropped: `plans/124 §1` records the user decision, and
125 §4 restates it with the reasoning (a corrected-results payload arriving after
completion does not apply under the admin-managed model). The tracker simply was not
updated.

**Recommended resolution:** confirm the drop, close `q68` and its 4 children as
`deferred` with a closing note pointing at `plans/124 §1`, and delete `plans/122`. Then
125's premise is sound on paper *and* in the tracker.

### 4. Fix the root cause, not just the backlog

Nine plans accumulated because deletion is a manual checklist step that nobody ran after
an epic closed. Cleaning up without addressing that means doing this again.

The detection is cheap — extract each plan's tracker reference, look up its status, report
mismatches. That belongs in the `Stop` hook Plan 139 introduces, or as a small CI check.

## Data Model / API Surface Implications

None.

## Dependencies

- **Plan 133** owns Plan 111's deletion via its persona-layout ADR slice. This plan does not touch
  111.
- **Plan 135** owns Plan 123's disposition. This plan does not touch 123.
- **Plan 139** determines the tracker substrate. If it lands first, decisions 2 and 3
  create GitHub issues rather than Beads items, and there is no point opening a Beads epic
  for 125 that is migrated days later.

## Sequencing trap

**Do not delete `plans/111` in a general cleanup sweep.** Its epic is closed, so a naive
pass would take it. But Plan 133 cites it as the source of the thin-pointer pattern it
reverses, and ADR-0002 requires the durable reasoning be codified first. Plan 133's
single-tool persona layout ADR is where that lands. Deleting 111 before that ADR exists
orphans the rationale at exactly the moment Plan 133 needs it.

## Execution Sequence

**First — the ADR-0002 codification audit.** Read each of the eight plans and decide what,
if anything, needs to reach `rules/` or `docs/adr/` first. This is the slice with real
judgment in it; the rest is mechanical.

**Second — codify what the audit found**, then delete the eight plans.

**Third — resolve 122.** Close `q68` and its four children as deferred with a note
pointing at `plans/124 §1`, **then** delete `plans/122`.

The order is load-bearing and cannot be half-done. ADR-0002's invariant is
*tracker item closes → plan file is deleted*. Deleting the plan first leaves four open
children referencing a file that no longer exists — a worse drift state than the current
one, and harder to diagnose later. Since closing the items requires the `bd` CLI, both
halves of this step happen in the same local session; neither is safe alone.

**Fourth — open 125's tracker item**, strip its slice table into the tracker, and fix its
123 cross-reference.

**Fifth — add the drift check** to the `Stop` hook or CI.

## Open Questions

- **How much of 124 becomes an ADR?** The admin-authoring model and lane-separation
  architecture are cross-cutting and outlive the plan. Too little and the pattern is lost;
  too much and the ADR becomes a copy of the plan, which defeats the point.
- **Does 125 run before or after the 132–140 workflow set?** It is product work and
  independent of all of it. It can go whenever, and arguably should go first — it is
  ready, valuable, and its plan will only get staler.

## Sources / Prior Decisions

- ADR-0002 — Plans are narrative; deleted after parent epic closes (the rule being enforced)
- Plan 133 — owns 111's deletion via its persona-layout ADR
- Plan 135 — owns 123's disposition
- Plan 139 — determines the tracker substrate and hosts the drift check
