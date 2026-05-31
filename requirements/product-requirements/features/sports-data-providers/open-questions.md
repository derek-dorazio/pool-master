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

- `SDP-R1` First-pass golf provider `(Resolved — tracked by active Golf sync/live-scoring epics)`
  - **Data Golf alone** covers events, field, rankings, scoring, results,
    and odds for golf — single subscription, single key, $30/mo.
  - The Odds API is **not** required for first-pass golf; it earns its
    place only when non-golf sports are activated.

- `SDP-R2` Cross-sport odds spine `(Resolved — future non-Golf provider work)`
  - When NCAA, soccer, or tennis is activated, The Odds API is the
    cross-sport odds adapter for those three sports. One subscription,
    one key, three sports. Golf odds remain on Data Golf.

- `SDP-R3` No single-vendor lock-in `(Resolved)`
  - PoolMaster integrates each provider behind the existing
    `SportDataProvider` port. Adapters are interchangeable per sport per
    feed via configuration.

- `SDP-R4` SportsDataIO and SportRadar are deferred `(Resolved)`
  - Sales-gated pricing and procurement friction make them poor first-pass
    choices. Both are kept as upgrade paths and can be added behind the
    same port without product or contract changes.

- `SDP-R5` Data Golf live polling rate-limit headroom `(Resolved — plan 119)`
  - Data Golf documents a shared 45 requests/minute rate limit.
  - PoolMaster's first production live-score cadence is 5 minutes, with QA
    scheduled cadence at 15 minutes and manual event sync used for most
    scenario testing.
  - This cadence is comfortably inside the documented rate limit for the
    first Golf implementation. If future fanout expands to many concurrent
    provider calls, that expansion needs its own rate-budget story before
    enabling it.
