# ADR 0013: Templates List Slots With a Coverage Mode; Results Come Only From the Feed

- **Status:** Accepted
- **Date:** 2026-11-24
- **Amends:** [ADR-0012](./0012-season-phase-slot-model-contests-cover-slots.md)

## Context

ADR 0012 was accepted on 2026-11-23. Two of its statements were overtaken by decisions Derek
settled the next day, during the final review of the league model redesign (epic #1917):

- It says a contest template names the slots it covers as "a list of slot definitions or a
  whole phase". A whole-phase cover would follow the phase as its slots change, which leaves a
  contest unable to say which slots it was played on, and a season-long contest on an open
  phase is not offered.
- It says "Admin edits remain for correcting a feed's mistake". Keeping a manual path means
  keeping the manual score, bracket, golf-round and race-order panels and CSV uploads, rebuilt
  on the new Game side results, as a second writer of results beside the feed.

ADRs are immutable, so this record amends ADR 0012 rather than editing it.

## Decision

**A template covers a list of slot definitions, never a whole phase, and how a contest uses
that list is the template's coverage mode. Results come only from the feed, and a correction
after settlement is applied with Re-settle.**

- **Coverage is a slot list plus a mode.** `ContestConfigTemplateSlot` lists the slot
  definitions a template covers; there is no phase coverage row. `ContestConfigTemplate.coverageMode`
  says how a contest uses the list:
  - `ONE_SLOT`: the list is where it may run, and the commissioner picks one slot (tiered,
    budget, quick pick, squares, a single-round Clutch Card).
  - `ALL_LISTED`: the contest covers every listed slot (brackets, a whole-playoffs Clutch
    Card, a majors pool).
  - `FROM_SLOT`: the commissioner picks a starting slot, and the contest covers it and every
    later listed slot (season-long pick'em and survivor).

  A contest copies only the slots its mode and the commissioner's choice give into
  `ContestSeasonSlot`, which stays the only record of what it covers. "The whole postseason"
  is a template that lists every postseason slot.
- **No admin edits or manual result entry for a feed's mistake.** Results come only from the
  feed; test events get theirs from the test data loader. The manual result panels and CSV
  uploads are deleted, not rebuilt. A feed failure raises a finding.
- **Corrections after settlement go through Re-settle.** The feed's new value is always
  stored, and settled results stay frozen. The finding offers a root admin Re-settle until the
  contest's championship year closes; re-settling recomputes the contest and everything
  downstream (finishes, medals, cups, the Championship), is audited, and notifies the league's
  commissioners.

### What this changes in ADR 0012

- "A list of slot definitions or a whole phase" becomes "a list of slot definitions, used by
  the template's coverage mode".
- "Admin edits remain for correcting a feed's mistake" is withdrawn: corrections are the
  feed's, applied with Re-settle.

Everything else in ADR 0012 stands.

## Consequences

- A contest's covered slots are fixed when it is made; a later change to a league's
  structure or a template affects only future contests.
- One writer of results: the feed. Nothing has to reconcile an admin's value with a later
  provider value, and no manual panel needs building on Game side results.
- A league whose feed gets a result wrong waits for the feed to fix it; the site cannot
  override it. A feed that never corrects a mistake leaves it standing.
- Re-settling needs its own audit and notification, and ends when the championship year
  closes, so history is final from then on.

## Alternatives considered

- **A template phase coverage row (`ContestConfigTemplatePhase`).** Deferred: a slot list says
  the same thing for every contest offered today. It is the fallback if trophy identity ever
  needs to survive a structure change.
- **Keep manual result entry for feed mistakes, rebuilt on Game side results.** Rejected: a
  second writer of results, panels for every result shape, and a provider-wins rule that would
  overwrite the edit on the next sync anyway.
- **Recompute settled contests automatically when the feed corrects a value.** Rejected: a
  finished contest's winners would change without anyone deciding to; Re-settle keeps the
  change deliberate, audited and announced.
