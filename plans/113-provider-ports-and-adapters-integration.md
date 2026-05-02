# Plan 113: Sports Data Provider — Ports & Adapters Integration

**Beads:** _to be opened as `pool-master-XXX` once Pam's brief is reviewed and
the first slice is approved._ See `bd show <epic-id>` for live slice state
once opened. This plan is the narrative companion; task tracking lives in
Beads.

**Inputs:**
- `requirements/product-requirements/features/sports-data-providers/overview.md`
  (Pam's provider business brief — recommended pair: Data Golf + The Odds API
  for first-pass golf, with cross-sport odds via The Odds API).
- `requirements/product-requirements/features/contest-event-feed-integration/overview.md`
  (event-first integration architecture).
- `plans/104-ingestion-config-persistence.md` (canonical feed names and
  scheduler shape).

## Purpose

Layer the recommended real-world sports data providers behind PoolMaster's
existing `SportDataProvider` port so:

- adapters are interchangeable per sport per feed via configuration
- no application code is bound to any specific vendor
- API keys, base URLs, and per-sport/per-feed bindings are configurable
  without code changes
- root admin can switch a feed from one provider to another (or back to the
  mock provider) without redeploy
- the existing scheduler (`ingestion-scheduler.ts`) and registry
  (`provider-registry.ts`) extend cleanly to support this

This plan is the code+config layer only. The mock provider's mirror of each
real provider's HTTP surface is plan 114.

## Governing Principles

- **The port is canonical.** All ingestion calls go through
  `SportDataProvider`. Adapters translate provider-shaped data into the
  canonical types defined in `provider-interface.ts`. No vendor-shaped DTO
  leaks into ingestion, scoring, or scheduler code.
- **Per-feed adapter routing.** Today the registry keys by sport at
  `PRIMARY` priority. We extend it to key by `(sport, feed, priority)` so
  the same sport can route `EVENTSCHEDULE` to one provider and
  `EVENTLIVESCORES` to another. This directly supports recommendations
  like "Data Golf for events/scoring, The Odds API for odds" without
  forcing one adapter to satisfy both.
- **Config beats code.** Provider keys and bindings are loaded from
  env + persisted runtime config, not hardcoded. Adding a provider is one
  adapter file plus one binding entry.
- **No silent fallbacks.** When a configured provider is missing or
  misconfigured, the scheduler logs and stays disabled for that
  (sport, feed). It does not silently switch to the mock provider. This
  preserves the rule already established in `provider-bindings.ts`.
- **Mock parity.** Every real adapter must have a mock-mode equivalent
  served by the mock-contest-feed-provider so QA and dev can exercise the
  full surface without external dependencies (plan 114 owns this).

## In Scope

- New adapters: `data-golf-adapter`, `odds-api-adapter` (replace the stub),
  `cfbd-adapter` (NCAA), `api-football-adapter` (soccer/World Cup),
  `api-tennis-adapter` (tennis).
- Per-feed binding model: registry keyed by `(sport, feed, priority)`.
- Config persistence: extend `PlatformRuntimeConfig` (added in plan 104) to
  carry `PROVIDER_BINDINGS_CONFIG` so root admin can edit live bindings.
- Secret management: API keys via env-only, never persisted in DB. Bindings
  reference a key alias that resolves to `process.env.<ALIAS>` at runtime.
- Health reporting: each adapter implements `healthCheck()`; health surface
  on existing admin sync screens shows status per `(sport, feed)` instead
  of just per provider.
- Admin UX: extend the existing root-admin ingestion config screen to:
  - list configured `(sport, feed) → provider` bindings
  - allow swapping a binding to another registered provider (or the mock)
  - show health and last-success timestamp per binding

## Out of Scope

- The mock provider's real-API mirror surface (plan 114).
- New sport families beyond GOLF / NCAA / SOCCER / TENNIS.
- Premium-vendor (SportRadar / SportsDataIO) adapters — deferred until a
  trigger from `SDP-006` is met.
- Redistribution licensing review — handled separately by legal.
- Rate-limit-aware queueing (deferred; the scheduler's existing interval
  config covers first-pass needs).

## Architecture Narrative

### Today

```
SportDataProvider (port)
   ├── MockContestFeedAdapter      ← active, the only registerable provider
   ├── EspnAdapter                 ← exported but unreachable (stub)
   ├── OddsApiAdapter              ← exported but unreachable (stub)
   ├── PgaTourAdapter              ← exported but unreachable (stub)
   └── Openf1Adapter               ← exported but unreachable (stub)
```

The registry binds one provider per sport at `PRIMARY`. The scheduler
fetches all five canonical feeds from that one provider.

**Important current constraint:** `provider-bindings.ts` hard-codes the
allowlist — `registerConfiguredProviders` throws on any `defaultProviderId`
other than `'mock-contest-feed'`. The four scaffolded real adapters are
present in source but cannot be wired up at runtime. Fixing this allowlist
is part of slice 1.

### After Plan 113

```
SportDataProvider (port)
   ├── MockContestFeedAdapter
   ├── DataGolfAdapter             ← new
   ├── TheOddsApiAdapter           ← new (replaces stub)
   ├── CfbdAdapter                 ← new
   ├── ApiFootballAdapter          ← new
   ├── ApiTennisAdapter            ← new
   └── (legacy stubs removed or repurposed)
```

The registry binds **per (sport, feed)**:

```
GOLF + EVENTSCHEDULE       → DataGolfAdapter
GOLF + EVENTPARTICIPANTS   → DataGolfAdapter
GOLF + PARTICIPANTRANKINGS → DataGolfAdapter
GOLF + EVENTLIVESCORES     → DataGolfAdapter
GOLF + EVENTRESULTS        → DataGolfAdapter
GOLF + ODDS                → TheOddsApiAdapter

NCAA_BASKETBALL + EVENTSCHEDULE → CfbdAdapter
NCAA_BASKETBALL + ODDS          → TheOddsApiAdapter
…
```

The scheduler asks the registry for the adapter that handles a specific
(sport, feed) tuple and uses it for that fetch. The single-provider-per-sport
case still works — every feed simply routes to the same adapter.

### Configuration Shape

Env (always required for keys):

```
SPORT_DATA_DEFAULT_PROVIDER=data-golf
DATA_GOLF_API_KEY=…
ODDS_API_KEY=…
CFBD_API_KEY=…
API_FOOTBALL_KEY=…
API_TENNIS_KEY=…
```

Bindings (env JSON for boot-time defaults; later overridable via
`PlatformRuntimeConfig`):

```jsonc
{
  "providers": {
    "data-golf":      { "baseUrl": "https://feeds.datagolf.com",   "keyEnvAlias": "DATA_GOLF_API_KEY" },
    "the-odds-api":   { "baseUrl": "https://api.the-odds-api.com", "keyEnvAlias": "ODDS_API_KEY" },
    "cfbd":           { "baseUrl": "https://api.collegefootballdata.com", "keyEnvAlias": "CFBD_API_KEY" },
    "api-football":   { "baseUrl": "https://v3.football.api-sports.io",   "keyEnvAlias": "API_FOOTBALL_KEY" },
    "api-tennis":     { "baseUrl": "https://v1.tennis.api-sports.io",     "keyEnvAlias": "API_TENNIS_KEY" },
    "mock-contest-feed": { "baseUrl": "http://localhost:3105", "keyEnvAlias": null }
  },
  "feedBindings": {
    "GOLF": {
      "EVENTSCHEDULE":       "data-golf",
      "EVENTPARTICIPANTS":   "data-golf",
      "PARTICIPANTRANKINGS": "data-golf",
      "EVENTLIVESCORES":     "data-golf",
      "EVENTRESULTS":        "data-golf",
      "ODDS":                "the-odds-api"
    },
    "NCAA_BASKETBALL": { "EVENTSCHEDULE": "cfbd", "ODDS": "the-odds-api", … },
    "SOCCER":          { "EVENTSCHEDULE": "api-football", "ODDS": "the-odds-api", … },
    "TENNIS":          { "EVENTSCHEDULE": "api-tennis", "ODDS": "the-odds-api", … }
  }
}
```

Key handling rules:
- Adapters receive the resolved key in their constructor; they never read
  `process.env` themselves.
- Missing key for a configured provider is a startup error; the scheduler
  refuses to register a half-configured provider.
- Keys are never logged. Health-reporting redacts the key alias when shown.

## Existing Adapter Stubs — Disposition

The four scaffolded adapter files in
`packages/core-api/src/modules/ingestion/adapters/` predate this plan and
are unreachable at runtime today. Each is decided here:

| File | LoC | Disposition | Rationale |
|---|---|---|---|
| `pga-tour-adapter.ts` | 403 | **Delete** | PGA Tour direct access requires partnership/licensing; Pam's brief recommends Data Golf instead. Keeping the stub is misleading. Replaced by `data-golf-adapter.ts` in slice 4. |
| `odds-api-adapter.ts` | 258 | **Replace in place** | The recommendation keeps The Odds API as the cross-sport odds spine. The current file is stub-quality and is rewritten end-to-end in slice 5; the filename and `providerId` are retained to minimize churn. |
| `espn-adapter.ts` | 324 | **Delete** | ESPN's unofficial endpoints have no SLA, no terms-of-service authorization for production data products, and would only ever be a best-effort fallback. We do not want a "fallback that secretly hides production outages." If we later need ESPN data for a specific resilience use case, we re-introduce it intentionally. |
| `openf1-adapter.ts` | 253 | **Delete** | Formula 1 is not on the recommended sport roadmap (golf → NCAA → soccer → tennis). The stub creates a false impression that F1 is supported. If F1 is added to the roadmap later, a fresh adapter built against the real port is cheaper than reviving a stale stub. |

All deletions land in slice 1 alongside the registry/allowlist work so
the codebase is honest about what is actually wired up before any new
adapters arrive.

## Suggested Slice Sequence

1. **Registry per-feed keying + stub cleanup + open the allowlist.**
   - Extend `ProviderRegistry` to bind by `(sport, feed)` tuples; the
     existing `register(sport, provider, PRIMARY)` call becomes "register
     for all feeds for this sport." Update `ingestion-scheduler.ts` to
     look up adapters per feed.
   - Replace the hard-coded `if (defaultProviderId !== 'mock-contest-feed')`
     check in `provider-bindings.ts` with a registry-driven allowlist
     populated from the bindings config. Mock remains the safe default.
   - Delete `espn-adapter.ts`, `pga-tour-adapter.ts`, and
     `openf1-adapter.ts`. Update `adapters/index.ts` exports. Leave
     `odds-api-adapter.ts` in place (rewritten in slice 5).
2. **Bindings config persistence.** Add `PROVIDER_BINDINGS_CONFIG` key to
   `PlatformRuntimeConfig`. Boot loader merges env defaults with persisted
   overrides.
3. **Secret resolver.** Introduce `keyEnvAlias` resolution in
   `provider-bindings.ts`; reject providers whose alias is missing or empty.
4. **Data Golf adapter.** First real adapter. Implements all five canonical
   feeds for `GOLF`. New file `data-golf-adapter.ts`.
5. **The Odds API adapter (rewrite).** Rewrite `odds-api-adapter.ts` to
   implement an `ODDS` feed only, keyed across multiple sports. Decision
   driven by `SDP-001` — single sport-aware adapter is the target.
6. **Admin UX — show bindings.** Read-only view first; lists
   `(sport, feed) → provider` and current health.
7. **Admin UX — edit bindings.** Root-admin can swap a `(sport, feed)`
   to any registered provider, including the mock. Scheduler hot-reloads on
   commit.
8. **CFBD adapter.** Adds NCAA basketball/football coverage.
9. **API-Football adapter.** Adds soccer/World Cup coverage.
10. **API-Tennis adapter.** Adds tennis coverage; gated on `SDP-004`
    confirming production readiness.

Each slice ships independently, in this order, behind feature flags or
config-only enablement so the live golf path is never broken.

## Testing Expectations

- **Unit:** every adapter has unit tests that mock the HTTP client and
  verify it produces canonical `SportDataProvider` types from sample
  responses. Sample responses live in test fixtures and are derived from
  real provider docs (no live network calls in unit tests).
- **Contract:** each adapter has a contract test that asserts it satisfies
  the full `SportDataProvider` interface for the sports it claims to cover.
- **Integration:** scheduler integration tests use the mock provider's
  real-API-shaped surface (plan 114) to verify the per-feed routing works
  end to end.
- **Admin UX:** functional API tests cover binding-edit flows and verify
  scheduler reloads bindings.
- **Defect-fix protocol:** any provider-specific bug (rate limit, schema
  change, auth) must land with a failing test that demonstrates the
  defect on the broken code path before the fix.

## Configuration & Operations Narrative

- **Local dev:** all bindings default to `mock-contest-feed` via env. No
  external keys needed.
- **QA:** bindings point to either the mock provider's real-API mirror
  (plan 114) or to real providers' free/dev tiers using QA keys. Default
  is the mirror, so QA never burns paid credits.
- **Prod:** real provider keys via env. Root admin can flip a single
  `(sport, feed)` to the mock provider's real-API mirror temporarily for
  outage mitigation _only if QA-mirrored URLs are reachable from prod_;
  otherwise prod has no fallback. (See `CEFI-R6` and `PRD-007`.)
- **Key rotation:** rotate by changing env values + service restart. No
  DB-stored secret has to be cleared.
- **Provider switch:** root-admin edits a single `(sport, feed)` row in
  the bindings UI. Audit log captures who/when/before-after.

## Risks & Mitigations

- **Risk:** Vendor schema drift breaks an adapter silently. **Mitigation:**
  contract tests pinned to fixtures + health check that asserts at least
  the smallest canonical projection on each poll cycle.
- **Risk:** API key leaks via logs. **Mitigation:** shared HTTP client
  layer that redacts auth headers before they reach the logger.
- **Risk:** Per-feed binding UI confuses commissioners. **Mitigation:**
  bindings UI is root-admin-only; nothing about bindings is exposed in
  league or commissioner surfaces.
- **Risk:** The Odds API credit model causes runaway spend.
  **Mitigation:** scheduler has a per-day call ceiling per provider that
  causes the feed to skip with a warning rather than burn credits.
- **Risk:** Single point of failure if The Odds API goes down for all
  sports' odds at once. **Mitigation:** per-feed bindings allow swapping
  to a different odds provider per sport without app changes.

## Open Questions Carried Forward

- `SDP-001` — sport-agnostic vs per-sport odds adapter shape (resolved by
  slice 5; currently leaning sport-aware single adapter).
- `SDP-002` — legal review of The Odds API; blocks slice 5 going live in
  prod, not slice 5 implementation.
- `SDP-003` — Data Golf rate limit headroom; informs slice 4 testing.
- `SDP-004` — API-Tennis production readiness; blocks slice 10.
- `SDP-005` — World Cup depth on API-Football; informs slice 9.
