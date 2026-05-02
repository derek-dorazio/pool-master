# Plan 114: Mock Provider — Real-Provider API Mirroring

**Beads:** _to be opened as `pool-master-XXX` once Pam's brief is reviewed
and plan 113 slice ordering is confirmed._ See `bd show <epic-id>` for live
slice state once opened. This plan is the narrative companion; task tracking
lives in Beads.

**Inputs:**
- `requirements/product-requirements/features/sports-data-providers/overview.md`
  (Pam's recommended providers).
- `plans/113-provider-ports-and-adapters-integration.md` (the adapters that
  must be exercisable end-to-end without external dependencies).
- `packages/mock-contest-feed-provider/README.md` (current mock surface,
  scenario contract, baseline scenarios for golf / tennis / NCAA / tie
  correction).

## Purpose

Extend the existing `mock-contest-feed-provider` Fastify service so it
exposes — alongside its current canonical mock API — a set of routes that
mirror the HTTP shape of each real provider PoolMaster integrates against.
This lets us:

- exercise each new real adapter end-to-end against deterministic fixture
  data without hitting paid endpoints
- run integration tests that assert each adapter correctly translates its
  vendor-shaped responses into canonical `SportDataProvider` types
- run QA, demos, and CI deterministically with no third-party dependency
- onboard new providers safely: build the mirror first, build the adapter
  against the mirror, then point at production

The mock service stays the **single source of fixture truth**. The same
event/participant/randomizer data feeds both the canonical mock surface
and every real-provider mirror surface — there is exactly one set of
named tournaments, players, scores, and odds.

## Governing Principles

- **One fixture core, many surface shapes.** The scenario JSON files
  under `contest-feed-scenarios/` plus the deterministic randomizers
  (golf score generator, odds projection) remain the only source of
  fixture data. Each real-provider mirror is a thin transform layer on
  top of that core. We never duplicate the fixtures into vendor-shaped
  files.
- **Real-provider HTTP shape, not real-provider depth.** The mirror
  reproduces request paths, query params, auth header expectations, and
  response field names accurately enough that each adapter's HTTP code
  treats the mirror as indistinguishable from the live API for the
  endpoints we use. We do not reproduce vendor endpoints we do not
  consume, and we do not reproduce edge cases the adapter never hits.
- **Mirror is non-production infrastructure.** This is the same posture
  as the canonical mock today: valid for local dev, CI, and QA — never a
  production fallback. The mock service is not deployed to prod and is
  not a hidden in-process fake.
- **Determinism preserved.** The randomizers stay seeded from
  `(scenarioId, eventId, tick, participantId)` so a given scenario's
  vendor-shaped payload is byte-identical run to run. This is what makes
  the mirror useful for contract assertions.
- **Auth is fake but enforced.** Each mirror surface validates the
  presence and shape of the auth token/header the real vendor expects
  (e.g. `apiKey` query param for The Odds API, `x-rapidapi-key` header
  for api-sports family) and rejects unauthenticated requests. This
  keeps adapter auth wiring honest.

## In Scope

- One mirror surface per recommended provider:
  - **Data Golf** — `/datagolf/*` mounted under a config-controlled
    base path (default `/mirror/datagolf/v1`)
  - **The Odds API** — `/odds/*` (default `/mirror/the-odds-api/v4`)
  - **CFBD** — `/cfbd/*` (default `/mirror/cfbd/v2`)
  - **API-Football** — `/api-football/*` (default
    `/mirror/api-football/v3`)
  - **API-Tennis** — `/api-tennis/*` (default `/mirror/api-tennis/v1`)
- For each mirror: only the endpoints actually consumed by the
  corresponding real adapter (per plan 113 slice for that adapter).
- Shared fixture-projection layer that maps canonical scenario data into
  vendor-shaped DTOs. Each mirror is one projection module.
- Auth shape validation per mirror.
- Swagger/OpenAPI export for each mirror surface, generated from the same
  Fastify route registration code so the mirror's contract is
  self-documenting.
- Update `packages/mock-contest-feed-provider/README.md` to describe the
  new mirror routes alongside the canonical ones.

## Out of Scope

- Vendor endpoints PoolMaster does not consume. If we never call
  `getHistoricalOdds`, the mirror does not implement it.
- Production-grade auth simulation. Token format is checked; token value
  is not.
- Data quality emulation (intentionally bad payloads, schema drift,
  outage simulation). That belongs to a separate "chaos scenarios"
  effort if/when needed.
- Replacing the canonical mock surface. The canonical
  `/v1/scenarios/...` routes stay and remain how PoolMaster's existing
  mock adapter operates by default.

## Architecture Narrative

### Today

```
mock-contest-feed-provider (Fastify, port 3105)
   └── /v1/scenarios/.../events/...       ← canonical mock surface
                                              served from scenario JSON
                                              + randomizers
```

A single Fastify service serves the canonical surface from JSON scenarios
plus deterministic randomizers (golf score generator, odds derivation).

### After Plan 114

```
mock-contest-feed-provider (Fastify, port 3105)
   ├── /v1/scenarios/.../events/...            ← canonical (unchanged)
   ├── /mirror/datagolf/v1/...                 ← Data Golf shape
   ├── /mirror/the-odds-api/v4/...             ← The Odds API shape
   ├── /mirror/cfbd/v2/...                     ← CFBD shape
   ├── /mirror/api-football/v3/...             ← API-Football shape
   ├── /mirror/api-tennis/v1/...               ← API-Tennis shape
   ├── /docs                                   ← Swagger UI (canonical)
   └── /docs/<mirror>                          ← Swagger UI per mirror
```

Internal layout:

```
src/
  scenario-store.ts          ← unchanged: canonical event/field/odds source
  randomizers/               ← extracted shared seeded score/odds randomizers
  routes.ts                  ← canonical routes (unchanged)
  mirrors/
    data-golf/
      routes.ts              ← Fastify routes mirroring datagolf.com shape
      projection.ts          ← scenario → datagolf payload transform
    the-odds-api/
      routes.ts
      projection.ts
    cfbd/
      routes.ts
      projection.ts
    api-football/
      routes.ts
      projection.ts
    api-tennis/
      routes.ts
      projection.ts
  app.ts                     ← registers canonical + each enabled mirror
```

### Configuration

Mirror enablement is config-controlled so a developer can run only the
mirror they care about:

```
MOCK_PROVIDER_MIRRORS_ENABLED=data-golf,the-odds-api
```

Empty / unset = canonical surface only (today's behavior). `all` =
every mirror.

### Endpoint Mapping (illustrative, not exhaustive)

Each mirror documents in its module README the precise endpoint→scenario
mapping, but the pattern is consistent:

| Real provider endpoint we consume | Mirror route | Source data |
|---|---|---|
| Data Golf `GET /preds/get-dg-rankings` | `GET /mirror/datagolf/v1/preds/get-dg-rankings` | scenario rankings projection |
| Data Golf `GET /preds/in-play` | `GET /mirror/datagolf/v1/preds/in-play?tour=pga&event_id=…` | scenario live-score randomizer keyed by tick |
| Data Golf `GET /betting-tools/outrights?market=win` | `GET /mirror/datagolf/v1/betting-tools/outrights?market=win` | scenario odds projection (win market for tier derivation; top-5/10/20/cut/FRL also supported) |
| The Odds API `GET /v4/sports/{sport_key}/odds` | `GET /mirror/the-odds-api/v4/sports/{sport_key}/odds` | scenario odds projection (NCAA / soccer / tennis only — golf odds come from the Data Golf mirror) |
| CFBD `GET /games?year=&week=` | `GET /mirror/cfbd/v2/games?year=&week=` | scenario schedule projection |
| API-Football `GET /fixtures?league=1&season=2026` | `GET /mirror/api-football/v3/fixtures?league=1&season=2026` | scenario schedule projection |
| API-Tennis `GET /tournaments?type=…` | `GET /mirror/api-tennis/v1/tournaments?type=…` | scenario draw projection |

Auth:
- Data Golf takes `key` query param.
- The Odds API takes `apiKey` query param.
- CFBD takes `Authorization: Bearer <key>`.
- api-sports family takes `x-rapidapi-key` and `x-rapidapi-host` (or
  `x-apisports-key` for direct access).

Each mirror enforces presence and shape but accepts any non-empty value.

## Suggested Slice Sequence

1. **Refactor mock service for mounting points.** Extract randomizers
   from `routes.ts` into `src/randomizers/`; introduce `src/mirrors/`
   directory; introduce `MOCK_PROVIDER_MIRRORS_ENABLED` config; no new
   endpoints yet. Canonical behavior unchanged.
2. **Data Golf mirror.** First mirror, golf-only. Endpoints needed by
   `data-golf-adapter` from plan 113 slice 4 — schedule, field, rankings,
   in-play scoring, results, **and** outright odds via
   `/betting-tools/outrights`. Swagger published. After this slice the
   mock service can stand in for the entire golf production stack.
3. **Adapter ↔ mirror integration tests.** A new test layer in
   `packages/core-api` that boots the mock service in mirror mode and
   exercises each adapter against the mirror, asserting the canonical
   `SportDataProvider` types are produced correctly. This test layer
   becomes the contract verification surface for every future provider.
4. **The Odds API mirror.** Pairs with plan 113 slice 7 (the fresh
   The Odds API adapter that activates alongside the first non-golf
   sport). Multi-sport from day one because the real adapter is
   multi-sport. Does **not** include golf — the Data Golf mirror is
   the canonical golf-odds substrate.
5. **CFBD mirror.** Pairs with plan 113 slice 8.
6. **API-Football mirror.** Pairs with plan 113 slice 9.
7. **API-Tennis mirror.** Pairs with plan 113 slice 10; gated on
   `SDP-004`.
8. **Documentation pass.** Update mock provider README, add a
   `mirrors/<provider>/README.md` per mirror with the endpoint→scenario
   mapping table, and link both into the main repo docs.

Each mirror lands in lockstep with the corresponding real adapter so
the adapter never exists without a deterministic test substrate.

## Testing Expectations

- **Unit:** projection modules have unit tests that assert the
  vendor-shaped payload matches a frozen fixture for a known scenario.
- **Route:** each mirror's Fastify routes have route-level tests that
  cover happy path, missing-auth rejection, unknown-event 404, and
  query-param parsing.
- **Cross-layer (the key one):** new integration suite in `core-api`
  boots the mock service with the relevant mirrors enabled, points
  each real adapter at the mirror, and asserts the adapter produces
  the canonical types defined in `provider-interface.ts`. This is the
  surface that catches drift between the mirror and the adapter.
- **Determinism:** every mirror endpoint must be deterministic for a
  given `(scenarioId, eventId, tick, ...)` input. A repeat-call test
  asserts byte-identical responses.

## Risks & Mitigations

- **Risk:** Mirror diverges from real vendor over time. **Mitigation:**
  per-mirror README captures the spec snapshot used; bumping the
  mirror to a new vendor version is an explicit, reviewable change.
  Adapter contract tests run against both mirror and (separately) a
  small set of recorded real-vendor fixtures so drift surfaces.
- **Risk:** Mirror grows endpoints we never use. **Mitigation:** each
  mirror only implements endpoints the corresponding adapter calls.
  New endpoints land only when an adapter slice needs them.
- **Risk:** Mirror is mistakenly used in production. **Mitigation:**
  same posture as today's canonical mock — mirror is not deployed to
  prod, the registration code in `provider-bindings.ts` cannot bind
  prod to a mock URL, and CI verifies that prod env config rejects
  any mock-style base URL.
- **Risk:** Mirror response sizes balloon CI time. **Mitigation:**
  scenarios stay small (tournament-sized, not season-sized) and
  randomizers stay cheap; mirror reuses the existing scenario file
  set.

## Open Questions Carried Forward

- `CEFI-007` — should the mock support scripted live progression over
  time, or only named snapshots and updates? This plan does not change
  that decision; mirrors inherit whatever progression mode the
  canonical scenarios offer.

## Relationship to Plan 113

| Plan 113 slice | Plan 114 slice that pairs with it |
|---|---|
| 4 — Data Golf adapter (incl. golf odds) | 2 — Data Golf mirror (incl. `/betting-tools/outrights`) |
| 7 — The Odds API adapter (NCAA / soccer / tennis only) | 4 — The Odds API mirror |
| 8 — CFBD adapter | 5 — CFBD mirror |
| 9 — API-Football adapter | 6 — API-Football mirror |
| 10 — API-Tennis adapter | 7 — API-Tennis mirror |

The pairing rule: an adapter slice in plan 113 does not ship without its
mirror slice in plan 114, because the adapter has nothing to be
integration-tested against until the mirror exists.
