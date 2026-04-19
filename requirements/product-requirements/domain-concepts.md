# Domain Concepts

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
