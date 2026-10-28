# Sports Data Providers — Open Questions

These question IDs are intended to stay stable as the discussion evolves. Each open question
carries a recommendation; Derek answers by ID. Refreshed 2026-10-28 with the
[brief](./overview.md).

## Open

- `SDP-007` Which providers to ask for a quote
  - Ask SportsDataIO and Sportradar now, both for production real-time on golf, NFL,
    college football, men's and women's college basketball, NBA, WNBA, MLB, NHL, NASCAR,
    soccer and tennis, with display rights on a commercial contest site. Ask each whether
    LPGA, LIV, DP World, F1, IndyCar, the PWHL, college baseball and softball are in.
  - **Recommendation:** ask both now. The quote is the only number in the brief we cannot
    look up, a sales cycle takes weeks, and two quotes are leverage. Derek sends the
    requests (it needs a company name and contact); signing waits for the production plan.

- `SDP-008` First adapter
  - **Recommendation:** SportsDataIO golf live scores, built on the free trial key and
    tested on Replay of a real 2026 tournament. Golf already has live sync and a scheduler,
    so it proves the port with the least new product work. Then Clutch Card box scores,
    then team-sport game scores. One ticket each, filed when Derek agrees.

- `SDP-009` The public-source pipeline's job from here
  - **Recommendation:** test data, season schedules, and results for sports no affordable
    provider covers (horse racing, cycling, marathons, the PWHL, NCAA tennis). Live scores,
    box scores and fields for provider-covered sports move to the provider as each adapter
    lands. Until then the pipeline keeps doing what it does now on QA.

- `SDP-010` Where the trial key lives
  - **Recommendation:** an AWS Secrets Manager secret through Terraform, like the other
    secrets, set on QA only; staging and prod get the production key later. Never in the
    repo or a workflow file.

- `SDP-003` Odds
  - Odds are not loaded today; tiers come from rankings and admin judgement.
  - **Recommendation:** keep it that way. Revisit only if a contest needs live odds; then
    The Odds API (free tier to build on, $30 a month and up) is the cheapest add-on, and
    the legal check in `SDP-002` comes first.

- `SDP-002` Legal acceptability of an odds aggregator
  - Only matters if `SDP-003` changes. **Recommendation:** parked with it.

- `SDP-011` Horse racing feed
  - **Recommendation:** none for now; the pipeline loads each race's field and result.
    Before the 2027 Triple Crown, one evaluation of Goalserve's horse racing package on its
    30-day free trial, the only self-serve US entries and results feed found.

- `SDP-001` Sport-agnostic adapter shape
  - Should one provider adapter take a sport on each call, or one instance per sport?
  - **Recommendation:** one adapter per provider taking the sport on each call, since
    SportsDataIO and Sportradar each use one API shape across sports; per-sport bindings
    stay configuration. Settle in the first adapter's ticket.

## Withdrawn

- `SDP-004` API-Tennis readiness: tennis now comes from the primary provider.
- `SDP-005` World Cup depth on API-Football: soccer now comes from the primary provider;
  API-Sports stays the cheaper fallback.
- `SDP-006` When to move to a premium provider: answered by the brief. There is no paid
  provider yet, and the recommendation starts with a premium one on its free test tiers.

## Resolved Decisions

- `SDP-R1` First-pass golf provider `(Reversed 2026-10-28)`
  - Was: Data Golf alone at $30 a month.
  - Now: Data Golf's terms limit its site and API to personal, non-commercial use, so it
    cannot back the site. Golf comes from the primary provider (`SDP-008`).

- `SDP-R2` Cross-sport odds spine `(Superseded by SDP-003)`

- `SDP-R3` No single-vendor lock-in `(Resolved, still holds)`
  - PoolMaster integrates each provider behind the existing `SportDataProvider` port.
    Adapters are interchangeable per sport per feed via configuration.

- `SDP-R4` SportsDataIO and Sportradar are deferred `(Reversed 2026-10-28)`
  - Was: sales-gated pricing made them poor first choices.
  - Now: both have free test environments, which is what the first pass needs; pricing
    only matters at production, and the cheap self-serve alternatives either forbid
    commercial use (Data Golf) or need several adapters.

- `SDP-R5` Live polling rate-limit headroom `(Resolved, carries over)`
  - Production live-score cadence is 5 minutes, QA 15 minutes, manual event sync for most
    scenario testing. Re-check against the chosen provider's production limits in the
    first adapter's ticket.

- `SDP-R6` Events are admin-authored `(Resolved, ADR 0009)`
  - A provider supplies scores, fields and an event lookup to events an admin has linked.
    It never creates events or moves their status. Provider choice does not change this.
