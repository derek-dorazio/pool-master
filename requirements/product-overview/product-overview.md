# Product Overview

PoolMaster is a sports contest platform built around real-world events, league
community play, and low-friction recurring use. The system should feel mostly
self-running: real-world schedules drive provider feeds, feeds create events
and participants, seeded contest templates keep setup fast, and automated
scoring updates flow through to entries and leaderboards without requiring
routine administrative intervention.

The product is designed around a few durable principles:

- real-world sports data is upstream truth
- normal operations should be automated and data-driven
- root-admin involvement is exceptional, not routine
- commissioners should have very little overhead beyond creating contests and
  handling occasional league administration
- commissioners are also members and should use the same team and entry tools
  that members use, with broader league-scoped authority when needed
- backend services must be operationally diagnosable through consistent
  structured logging rather than ad hoc console output or silent failures

The first end-to-end product loop is:

1. provider imports a real event and participant field
2. PoolMaster resolves event timing from defaults
3. commissioner creates a contest from a seeded template
4. teams create entries and make selections
5. automated backend jobs update live scoring and leaderboards

This product direction should scale across sports by preserving the same core
pattern:

- event and field imported from providers
- contest derived from the event
- team entries derived from the contest field
- live scoring propagated automatically from provider updates
