# Sports Data Providers — Open Questions

These question IDs are intended to stay stable as the discussion evolves.

## Blocking Questions

- None currently blocking the integration plan; the plan can begin against
  the recommended pair (Data Golf + The Odds API) for golf.

## Non-Blocking Questions

- `SDP-001` Sport-agnostic odds adapter
  - Should the odds adapter be one shared adapter that accepts a sport key
    on each call, or one registered adapter instance per sport?
  - Affects `provider-bindings.ts` shape and per-sport configuration.

- `SDP-002` Legal acceptability of The Odds API
  - Confirm The Odds API's bookmaker aggregation is acceptable for our use
    (contest tier derivation, not betting).
  - Owner: legal/compliance review before we depend on it.

- `SDP-003` Data Golf rate-limit headroom
  - 45 RPM ceiling — does this accommodate live-poll cadence during a
    tournament weekend with multiple concurrent contests?
  - Owner: Brad to model worst-case poll storm against the rate budget.

- `SDP-004` API-Tennis production-readiness
  - Tennis API is currently flagged as beta on api-sports.io.
  - Confirm SLA / breaking-change posture before we depend on it for a
    Grand Slam window.

- `SDP-005` World Cup depth on API-Football
  - Confirm API-Football covers everything we want for World Cup contests
    (lineups, fixtures, group → knockout brackets, live scoring, results).
  - If gaps exist, evaluate Sportmonks World Cup add-on.

- `SDP-006` Premium upgrade trigger
  - When should we move primary feeds from Data Golf / CFBD / API-Football
    to SportsDataIO or SportRadar?
  - Likely triggers: redistribution licensing, official-feed contractual
    requirement, or rate-limit ceilings.

## Resolved Decisions

- `SDP-R1` First-pass golf provider pair `(Resolved — pending plan 113)`
  - Data Golf for events / field / rankings / scoring / results.
  - The Odds API for outright/matchup odds.

- `SDP-R2` Cross-sport odds spine `(Resolved — pending plan 113)`
  - The Odds API is the cross-sport odds adapter for golf, NCAA, soccer,
    and tennis. One subscription, one key, four sports.

- `SDP-R3` No single-vendor lock-in `(Resolved)`
  - PoolMaster integrates each provider behind the existing
    `SportDataProvider` port. Adapters are interchangeable per sport per
    feed via configuration.

- `SDP-R4` SportsDataIO and SportRadar are deferred `(Resolved)`
  - Sales-gated pricing and procurement friction make them poor first-pass
    choices. Both are kept as upgrade paths and can be added behind the
    same port without product or contract changes.
