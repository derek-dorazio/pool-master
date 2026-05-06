# Domain Concepts

## Scope — What PoolMaster Is And Is Not

PoolMaster is a platform for **office-style pools** organized around big
sporting events: bracket pools, knockout pools, roster picks, weekly pick'em,
survivor, predict-top-N. Members of a league submit entries and compete on a
leaderboard for the duration of the event.

PoolMaster is **not**:

| Pattern | Why it's out of scope |
|---|---|
| Season-long fantasy sports (waivers, trades, weekly lineup management) | Persistent player ownership and transactional team management is a different product |
| Daily Fantasy Sports (DraftKings / FanDuel — daily contests, salary cap, stat-based scoring) | Different cadence and stat economy than office pools |
| Sportsbook (moneyline / spread / parlay betting) | Odds-based settlement is a regulated product space PoolMaster does not enter |
| Prop bets (over/under specific stats, first-to-score, etc.) | Per-stat resolution per event is a different product shape |
| Squares pools (Super Bowl 100-square grid) | Classic office pool, but a different substrate (grid + cell + score-digit, not participant + pick); deferred to future work if/when added |

This scope statement bounds the substrate. Models, DTOs, and contracts
described in PoolMaster's design plans assume the office-pool product space —
they should not be extended to absorb fantasy / DFS / sportsbook / prop-bet
products without a deliberate, multi-phase substrate redesign.

## Sporting Event

A real-world scheduled competition imported from provider data. PoolMaster does
not normally author these manually.

## Event Field

The participant set for a specific sporting event. It is upstream truth for
contest derivation.

## Contest Template

A seeded reusable product configuration that provides the default contest setup
experience for a given sport and contest style.

## Contest

A league-scoped competition derived from a sporting event plus a selected
template and any optional advanced overrides. Contest creation immediately
makes the contest live for entries in the normal flow.

## Contest Field

The contest-specific interpretation of the event field, including frozen rules
such as tiers, prices, ordering, and other selection constraints that members
use when building entries.

## Entry Selection UI

The member-facing selection experience for building an entry. This is
contest-type-specific rather than universal. First pass should target tiered
golf.

## Entry

A team-owned participation record inside a contest. A team may have multiple
entries when the contest allows it.

## Live Scoring

An automated backend process that consumes provider updates, refreshes event
and participant facts, recalculates entry scores, and updates leaderboard
ordering without normal manual operation.

## Leaderboard

The primary live and final standings view for a contest. It is a cross-sport
concept, but the exact score/detail columns vary by sport.

## Contest History

The completed-contest archive for a league. First-pass history focuses on
browsing prior completed contests by sport and contest type.
