# ADR 0014: No Multi-Event Field Pools; Cups Sum the Per-Event Contests

- **Status:** Accepted
- **Date:** 2026-11-24
- **Amends:** [ADR-0013](./0013-templates-list-slots-results-only-from-feed.md)

## Context

ADR 0013 gives "a majors pool" as an example of an `ALL_LISTED` template: one tiered pool
whose entries pick golfers once and score across all four majors. The platform shipped four
such templates (PGA and LPGA majors pools, ATP and WTA Grand Slam tiered pools).

The events sync loads a whole season's schedule ahead, but a tournament's field arrives only
days before it starts. A pool over four majors would take its picks from the first major's
field, and every later major's field is unknown when the picks are made. Derek ruled on
2026-11-24, during the final code pass of the league model redesign (epic #1917), that this
kind of contest is not practical and is not needed: the Majors Cup and the Grand Slam Cup
already crown a season across the majors.

ADRs are immutable, so this record amends ADR 0013 rather than editing it.

## Decision

- **Tiered, budget and sweepstakes contests never span events.** A field pool covers one
  event. A contest on one major is `ONE_SLOT` and counts toward cups.
- **`ALL_LISTED` covers listed slots of one event only**: a bracket, a tiered, budget or
  sweepstakes pool over several postseason slots of one event, or a whole-playoffs Clutch
  Card. The "majors pool" example in ADR 0013 is withdrawn.
- **Only pick'em and survivor span events**, through `FROM_SLOT` over a Season's weekly
  events.
- **A season across the majors is the Majors Cup or the Grand Slam Cup**, which sum the
  per-major contests that count toward cups. There is no cross-event field pool beside them.
- **The four multi-event templates are deleted by migration**, with the code that only they
  use (the missed-lineup scoring and the multi-event event sequence reading).
- **Coverage is fixed at creation.** Since the sync loads the season schedule ahead, no
  handler adds a newly created slot to an existing contest.

## Consequences

- One contest per major, each with its own field and pick window.
- If a multi-event field contest is ever wanted, it takes one set of picks made once (for
  example, one golfer for the next three tournaments), from fields known at pick time. That
  is not built, and is not to be built unless it needs nothing special to set up.

## Alternatives rejected

- **Keep the majors pools, with picks from the first major's field.** Later majors' fields
  differ, so entries would hold golfers who do not play, and the cups already serve the
  season-long purpose.
- **Re-open picks before each major.** That is four contests in one, with four pick windows
  and partial lineups; four `ONE_SLOT` contests summed by a cup say the same thing simply.
