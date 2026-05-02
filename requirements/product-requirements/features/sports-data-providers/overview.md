# Sports Data Providers — Business Brief

## Purpose

Choose the third-party data providers PoolMaster will integrate behind the
existing `SportDataProvider` port to deliver real events, fields, rankings,
live scores, results, and odds. This brief covers four sport families in
priority order:

1. **Golf** — first-pass production sport `(Confirmed)`
2. **NCAA tournaments** — second wave (men's basketball, college football
   playoff) `(Inferred — follows after golf full lifecycle)`
3. **World Cup soccer** — tournament-shaped, similar to golf model
   `(Inferred)`
4. **Tennis Grand Slams** — tournament-shaped, similar to golf model
   `(Inferred)`

Pairs with [`contest-event-feed-integration`](../contest-event-feed-integration/overview.md).
This brief feeds Archie's integration plan (`plans/113-…`) and Brad's
mock-provider mirror plan (`plans/114-…`).

## Selection Goals

- **No vendor lock-in.** PoolMaster speaks to the canonical
  `SportDataProvider` port. Adapters are interchangeable per sport per feed.
- **Frictionless first-pass cost.** First-pass golf must be runnable on a
  combined provider spend of well under $100/month, ideally near $30/month,
  so we can ship and iterate without procurement friction.
- **Public, self-serve API keys.** Avoid providers whose only access path is
  a sales conversation until we have demonstrated product-market fit.
- **Coverage of the full canonical feed set:** `EVENTSCHEDULE`,
  `EVENTPARTICIPANTS`, `PARTICIPANTRANKINGS`, `EVENTLIVESCORES`,
  `EVENTRESULTS`, plus odds when needed for tier/price derivation
  (see plan 104).
- **Mockability.** Each chosen provider must have a documented HTTP API we
  can mirror in the mock service so the product is exercisable end-to-end
  without hitting paid endpoints.

## Sport Family 1 — Golf `(First Pass)`

### Coverage Requirements

- tournament schedule (PGA Tour and majors)
- field/entry list per tournament
- world rankings
- live round/hole scoring
- final results
- outright winner odds for tier derivation

### Candidate Providers

| Provider | Cost (USD) | Coverage | API Key | Notes |
|---|---|---|---|---|
| **Data Golf** | $30/mo or $270/yr (Scratch PLUS) `(Confirmed)` | schedule, field, predictions, live scoring (5-min cadence), historical archive, outright/matchup/3-ball odds from 11+ books | self-serve, single key, 45 RPM rate limit `(Confirmed)` | strong golf-only depth, well-loved in DFS community, modest rate limit |
| **The Odds API** | Free 500 credits/mo; $30 / $59 / $119 / $249 paid tiers `(Confirmed)` | golf majors odds (Masters, PGA Championship, US Open, Open Championship), outrights/futures, 40+ books | self-serve, single key, credit-based metering | does NOT provide schedule/field/scoring beyond odds context — odds-only complement |
| **SportsDataIO PGA Golf** | Not publicly priced; 1,000-call free trial; paid via sales (industry estimate $500–$1,000+/mo) `(Inferred)` | full PGA schedule, field, live scoring, results, world rankings | self-serve key after trial; paid tier requires sales | enterprise-grade, but pricing opacity violates frictionless-cost goal for first pass |
| **SportRadar Golf** | Enterprise, sales-only (industry estimate $500–$1,000+/mo) `(Inferred)` | comprehensive PGA + LPGA + DP World + Champions, in-play, official | sales-gated keys | premium upgrade path; not first pass |
| **PGA Tour direct** | Partnership/license required `(Inferred)` | first-party | not self-serve | scaffolded adapter exists but is non-viable without licensing |
| **ESPN (unofficial)** | Free `(Confirmed)` | scores, schedules, leaderboards | none | undocumented, unstable, no SLA — usable only as best-effort fallback |
| **RapidAPI live-golf-data, golf-leaderboard-data** | Freemium / cheap `(Inferred)` | leaderboard scrape feeds | RapidAPI key | lower-quality option; not recommended for primary |

### Recommendation `(Inferred)`

- **Primary events + field + scoring + results + rankings:** Data Golf
  Scratch PLUS at $30/mo.
- **Primary outright odds (for tier/price derivation):** The Odds API,
  starting on the free 500-credit tier; upgrade to $30/mo only when usage
  demands.
- **Combined first-pass golf cost:** ~$30/mo, optionally $60/mo.
- **Premium upgrade path:** SportsDataIO or SportRadar when we outgrow
  Data Golf's rate limit or need licensed/official feeds for redistribution.

### Why this pair

- Both have public self-serve keys and predictable pricing.
- Together they cover all five canonical feeds plus odds without overlap.
- Data Golf is golf-specific and deep; The Odds API is multi-sport, so the
  same odds adapter can be reused for NCAA / soccer / tennis later.
- Enterprise providers are deliberately deferred — their value is real but
  their pricing and procurement model is hostile to a first-pass product.

## Sport Family 2 — NCAA Tournaments `(Second Wave)`

### Coverage Requirements

- bracket structure (March Madness, College Football Playoff)
- team roster / participant list per tournament
- team and conference rankings (AP, Coaches Poll, Net, etc.)
- live game scores
- final results
- futures / champion odds

### Candidate Providers

| Provider | Cost (USD) | Coverage | API Key | Notes |
|---|---|---|---|---|
| **CollegeFootballData (CFBD)** | Free key, 1,000 calls/mo free; Patreon tiers $5–$30/mo for higher quotas `(Confirmed)` | full FBS schedule, rosters, rankings, results, advanced stats; CollegeBasketballData uses same key for NCAA MB | self-serve | best free production-quality NCAA football + men's basketball source |
| **NCAA-API (henrygd/ncaa-api)** | Free `(Confirmed)` | live scores, brackets, standings via ncaa.com proxy | none | OSS wrapper; rate-limited by upstream, no SLA |
| **The Odds API** | (see Golf row) | NCAA basketball + football h2h, spread, totals, outrights/futures | shared key | shared subscription with golf — no extra cost |
| **ESPN (unofficial)** | Free | NCAA brackets, scores, news | none | unsupported; useful as a third source |
| **SportsDataIO NCAA Basketball / Football** | Sales-priced, ~$500–$1,000+/mo each `(Inferred)` | comprehensive, licensed | sales-gated | premium upgrade path |
| **SportRadar NCAA MB / WB / FB** | Sales-priced | comprehensive, licensed | sales-gated | premium upgrade path |

### Recommendation `(Inferred)`

- **Primary schedule + rosters + scoring + results:** CFBD (free) for
  football and basketball.
- **Secondary live scoring + brackets:** NCAA-API or ESPN unofficial as a
  resilience layer.
- **Primary odds:** The Odds API (already owned for golf).
- **Combined incremental cost over golf:** $0 first pass.

## Sport Family 3 — World Cup Soccer `(Tournament-Shaped)`

### Coverage Requirements

- tournament bracket (group → knockout)
- team / squad / player participant lists
- group stage and knockout fixture list
- live scores
- final results
- match and outright odds

### Candidate Providers

| Provider | Cost (USD) | Coverage | API Key | Notes |
|---|---|---|---|---|
| **API-Football (api-sports.io)** | Free 100/day; Pro $19/mo 7.5k/day; Ultra $29/mo 75k/day; Mega $39/mo 150k/day `(Confirmed)` | 1,200+ competitions including FIFA World Cup 2026, lineups, events, stats, odds (limited) | self-serve | best price/coverage ratio for World Cup |
| **Football-data.org** | Free tier; €10–€50/mo paid tiers `(Inferred)` | major competitions including World Cup, FIFA, EPL | self-serve | cheaper than API-Football; less depth |
| **Sportmonks World Cup API** | Paid plan, World Cup add-on `(Inferred)` | dedicated WC product | self-serve | overkill if World Cup is one tournament every four years |
| **The Odds API** | (shared) | World Cup match + outright odds | shared key | reuse |
| **SportRadar Soccer** | Enterprise sales | comprehensive | sales-gated | premium upgrade path |

### Recommendation `(Inferred)`

- **Primary fixtures + lineups + scoring + results:** API-Football Pro
  ($19/mo) — only activated during a World Cup window.
- **Primary odds:** The Odds API (shared).
- **Combined incremental cost during a WC tournament window:** ~$19/mo for
  the active months; pause subscription between tournaments.

## Sport Family 4 — Tennis Grand Slams `(Tournament-Shaped)`

### Coverage Requirements

- Grand Slam draw and bracket
- player field per tournament
- ATP / WTA rankings
- match scoring (set, game, point optional)
- final results
- match and outright odds

### Candidate Providers

| Provider | Cost (USD) | Coverage | API Key | Notes |
|---|---|---|---|---|
| **API-Tennis (api-sports.io)** | Tier shared with API-Sports family, Pro/Ultra/Mega same shape `(Inferred)` | ATP/WTA tour, draws, rankings, fixtures, results, live scoring | self-serve | beta status — verify production readiness before depending on it |
| **Goalserve Tennis** | $150/mo `(Confirmed — listed)` | Grand Slams, ATP, WTA, ITF, junior | self-serve | predictable but expensive vs api-sports |
| **The Odds API** | (shared) | Grand Slams, ATP 1000/500, WTA 1000/500 odds | shared key | reuse |
| **SportRadar Tennis** | Enterprise | comprehensive | sales-gated | premium upgrade path |

### Recommendation `(Inferred)`

- **Primary draws + rankings + scoring + results:** API-Tennis Pro tier
  (~$19/mo on api-sports family) — only during Grand Slam windows; verify
  beta-vs-stable status before locking in.
- **Primary odds:** The Odds API (shared).
- **Combined incremental cost during a Grand Slam window:** ~$19/mo for the
  active months.

## Cross-Sport Rollup

| Feed | Recommended Provider |
|---|---|
| Golf events / field / rankings / scoring / results | Data Golf `(Inferred)` |
| Golf odds | The Odds API `(Inferred)` |
| NCAA football events / rosters / scoring / results | CFBD `(Inferred)` |
| NCAA basketball events / rosters / scoring / results | CFBD + NCAA-API resilience layer `(Inferred)` |
| NCAA odds | The Odds API `(Inferred)` |
| Soccer / World Cup events / lineups / scoring / results | API-Football `(Inferred)` |
| Soccer / World Cup odds | The Odds API `(Inferred)` |
| Tennis events / draws / rankings / scoring / results | API-Tennis (api-sports family) `(Inferred — pending beta verification)` |
| Tennis odds | The Odds API `(Inferred)` |

### Steady-State Cost Envelope `(Inferred)`

- **Always-on:** Data Golf $30/mo + The Odds API $30/mo = **$60/mo**.
- **Plus active NCAA season:** $0 incremental (CFBD free).
- **Plus active World Cup window:** +$19/mo (API-Football Pro).
- **Plus active Grand Slam window:** +$19/mo (API-Tennis Pro).
- **Cross-sport peak:** ≈ **$98/mo** during overlapping events.

### Provider Consolidation Note

No single provider gives PoolMaster all sports for a reasonable price. The
recommended approach uses **The Odds API as a single cross-sport odds spine**
(one key, one bill, four sports) and **per-sport native providers for
everything else**. This is exactly the use case the ports & adapters pattern
exists to support.

## Why Not Single-Vendor Coverage

- **SportRadar** and **SportsDataIO** can technically cover all four sport
  families from one billing relationship, but pricing is sales-gated, almost
  certainly exceeds $1,000/mo total, and is gated behind contracts. We can
  upgrade to either later without changing the port — that is the point of
  the adapter layer.

## Open Questions

- `SDP-001` Should the **odds adapter** be modeled as a sport-agnostic
  cross-sport adapter that just takes a sport key, or as one adapter
  instance registered per sport? `(Needs Review)` — affects how
  `provider-registry.ts` keys bindings.
- `SDP-002` Is **The Odds API** legally acceptable as our only odds source
  given its bookmaker aggregation model and our use case (contest tier
  derivation, not betting)? `(Needs Review — legal/compliance)`
- `SDP-003` Does Data Golf's 45 RPM rate limit accommodate our planned
  live-poll cadence for `EVENTLIVESCORES` during a tournament weekend?
  `(Needs Review — operational)`
- `SDP-004` What is the production-readiness status of API-Tennis (still
  flagged as beta)? `(Needs Review — vendor)`
- `SDP-005` Is API-Football's coverage depth for FIFA World Cup 2026
  sufficient for our planned contest types, or should we add Sportmonks
  World Cup add-on for that one tournament? `(Needs Review)`

## Handoff

This brief is the input for:

- **Archie + Brad** — `plans/113-…`: integration plan to layer these
  providers behind the existing `SportDataProvider` port, with
  configuration, key management, and per-feed provider switching.
- **Brad** — `plans/114-…`: mock-provider plan to mirror each real
  provider's HTTP surface so the existing scenario fixtures can be served
  through both the canonical mock API and a real-provider-shaped surface.
