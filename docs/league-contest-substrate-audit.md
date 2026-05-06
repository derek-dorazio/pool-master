# League / Contest / Scoring substrate audit (Phase 1, `pool-master-rop.78`)

**Status:** Phase 1 deliverable. **Findings written first** (sections 1–7); existing `pool-master-rop.*` defects are cross-referenced in section 8 so the audit's analysis isn't shaped by their pre-investigated framing. **Pause for user review before Phase 2 (the design plan).**

**Author:** Archie (lead) with Dom (domain) + Brad (service / scoring pipeline). All claims are anchored to file paths + line ranges captured at commit `b8a1385d` (post-merge of PR #14, #15, #16, #17).

---

## 1. Data-flow overview

Two data flows define the substrate's behavior. Both terminate at a Standings row and a ContestEntry score; the seams between them are where most of the recurring defects accumulate.

### 1.1 Live-scoring write path (provider → standings)

```
Provider (mock-feed / odds-api / openf1 / espn / pga-tour)
    ↓
IngestionScheduler.runSportSync / pollLiveScores / fetchEventResults
    [packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts]
    ↓
Adapter.getLiveScores → ProviderStatEvent[]
    [packages/core-api/src/modules/ingestion/adapters/<provider>-adapter.ts]
    ↓
publishStatEvents(events) — emits 'stat.received' on EventBus per event
    [packages/core-api/src/modules/ingestion/core/score-publisher.ts:13]
    ↓
EventBus.subscribe<'stat.received'> in subscribeStatEventConsumer
    [packages/core-api/src/modules/scoring/consumer/stat-event-consumer.ts:119]
    ↓
handleStatEvent(deps, event)
    - ContestLookup.findActiveContestsForProviderParticipant — DB query per event
    - For each active contest: scoringEngine.score(...) → write to per-entry table
    - Publishes 'score.updated' per (contest, entry) computed
    [packages/core-api/src/modules/scoring/consumer/stat-event-consumer.ts:86–117]
    ↓
ScoringService persists the entry score
    [packages/core-api/src/modules/scoring/service.ts]
    ↓
StandingsRollup (PERIODIC + on-demand)
    [packages/core-api/src/modules/scoring/rollup/standings-rollup.ts:37]
    - rollupContest(contestId) — SELECT entry totals → assign ranks → persist standings
    - rollupAll() — periodic loop wakes up and rolls up all active contests
    - Publishes 'standings.updated'
    ↓
Standings row in DB (the read model for ranked entries)
```

**Parallel write path:** `ContestScoringRecalculationService.recalculateContest(contestId)` walks every entry of a contest and recomputes scores from scratch. Invoked manually (admin override) or after configuration changes. Also assigns ranks. `[packages/core-api/src/modules/contest-scoring/contest-scoring-recalculation-service.ts:36–46]`

### 1.2 Read path (frontend → wire format → frontend cache)

```
React component
    ↓
TanStack Query useQuery({ queryKey: [...], queryFn: () => SDK.fooBar(...) })
    [36 React Query files; 68 distinct queryKey shapes inline today]
    ↓
Generated SDK call (@poolmaster/shared/generated/hey-api)
    ↓
HTTP request through clients/poolmaster/src/lib/api.ts interceptors
    (X-Client-Trace-Id, X-Client-Request-Id, CSRF, retry-on-401)
    ↓
Fastify route in packages/core-api/src/modules/<area>/routes.ts
    - Zod schema validates request body / params (or doesn't — see §3)
    - Route handler delegates to service layer
    ↓
Service layer (packages/core-api/src/modules/<area>/service.ts)
    - Uses Prisma against Postgres
    - Returns domain objects (League, Contest, ContestEntry, ...)
    ↓
Mapper (packages/core-api/src/mappers/<area>.mapper.ts) — sometimes
    - Domain → DTO transformation
    - Some routes skip the mapper and emit domain objects raw (see §3)
    ↓
Fastify response serializer
    - Validates against the route's response schema (Zod-derived)
    - Some response schemas are JsonObjectSchema, which validates trivially (see §3)
    ↓
Generated SDK consumer types (@poolmaster/shared/generated/hey-api/types.gen.ts)
    - Inherits the contract's typing — typed if the DTO is, opaque if not
    ↓
React Query cache
    - Stored under the inline queryKey
    - Component reads via useQuery(...).data
    ↓
Sometimes copied into Zustand or local component state (see §4)
```

The **seams** that produce defects:
- **Service ↔ Mapper:** when the mapper is missing or thin, the route emits domain shape verbatim. Wire format becomes whatever Prisma + service code happened to produce.
- **DTO Schema ↔ OpenAPI ↔ Generated SDK:** `JsonObjectSchema` in a DTO erases the field types from the generated SDK. Frontend gets `Record<string, unknown>`.
- **React Query cache ↔ Zustand store ↔ component state:** server data sometimes lives in three places at once, drifting on refetch.
- **Provider adapter ↔ ProviderStatEvent ↔ Stat consumer:** what the provider emits, what the event bus carries, and what scoring expects diverge. Most providers don't have a normalized contract at the seam.

---

## 2. Domain model snapshot

**Source:** `packages/shared/domain/types.ts` (the canonical TypeScript domain), `packages/shared/domain/enums.ts` (lifecycle constants), `packages/core-api/prisma/schema.prisma` (storage shape).

### 2.1 Entities in scope of this audit

| Domain interface | Persistence | Lifecycle states | Key relationships |
|---|---|---|---|
| `User` | `User` table | `isActive` boolean | Owns Squads; member of Leagues |
| `League` | `League` table | `isActive` (soft-delete), `joinPolicy` | Has Memberships, Contests, AuditEntries |
| `LeagueMembership` | `LeagueMembership` table | `role` (COMMISSIONER / MEMBER / etc.), `isActive` | User ↔ League |
| `LeagueInvitation` | `LeagueInvitation` table | `status` (PENDING / ACCEPTED / EXPIRED / etc.), `inviteCode` | Belongs to League |
| `Squad` | `Squad` table | `isActive` | Owned by User; member of multiple Leagues via `SquadMembership` |
| `Contest` | `Contest` table | **`status` enum** (DRAFT → OPEN → DRAFTING → LOCKED → ACTIVE → COMPLETED → CANCELLED) | Belongs to League + SportEvent |
| `ContestEntry` | `ContestEntry` table | `status`, owner Squad | Belongs to Contest; has `RosterPick`s |
| `RosterPick` | `RosterPick` table | (no lifecycle) | Belongs to ContestEntry; references Participant |
| `DraftSession` | `DraftSession` table | (TBD) | Drives the DRAFTING phase of a Contest |
| `Participant` | `Participant` table | `status`, `injuryStatus` (struct) | Belongs to a Sport; has `ParticipantSeasonRecord`, `ParticipantProviderMapping`s |
| `SportEvent` | `SportEvent` table | `status` enum, `startTime` | Belongs to a Sport + Season; aggregates `SportEventParticipant`s |
| `SportEventParticipant` | `SportEventParticipant` table | (no explicit lifecycle) | Joins SportEvent + Participant |
| `SportEventParticipantValuation` | `SportEventParticipantValuation` table | (provider snapshot) | Per-provider valuation data |
| `ProviderStatEvent` | (in-memory event-bus payload — not persisted) | — | Emitted by adapters during ingestion |

### 2.2 Lifecycle of a Contest (the central state machine)

```
DRAFT → OPEN → DRAFTING → LOCKED → ACTIVE → COMPLETED
                                 ↘ CANCELLED (terminal at any point)
```

- **DRAFT** — commissioner is configuring; not visible to members
- **OPEN** — accepting entries
- **DRAFTING** — draft session active (snake / auction etc.)
- **LOCKED** — entries finalized; SportEvent has not started
- **ACTIVE** — SportEvent is live; scoring is processing stat events
- **COMPLETED** — SportEvent ended; final scores + standings frozen
- **CANCELLED** — explicit cancel from any state

Read by `contestPicksRevealed(status)` in `contests/service.ts:1239` to gate pick visibility; by `isContestJoinable(status)` to gate `OPEN` membership writes.

### 2.3 Where the model is opaque to the wire

Domain interfaces exist for almost every entity, but **the wire-format DTOs do not always match**. Specifically:

- `LeagueAuditEntry` has a real shape in `audit-service.ts:13` (`AuditLogEntry` interface — id, leagueId, contestId?, actorId, action, category, description, beforeState?, afterState?, reason?, ipAddress?, createdAt) but the DTO is `JsonObjectSchema` (untyped passthrough). Frontend reads opaque `Record<string, unknown>`.
- `CommissionerDashboard` has a real shape in `types.ts:504` (League + ActionItem[] + Contest[] + counts + activity) but the DTO emits `JsonObjectSchema` for the embedded League and Contest payloads.
- `LatestPerformance` is deliberately opaque even at the service layer — `normalizeLatestPerformance(value: unknown): Record<string, unknown>` in `contests/service.ts:1219` just type-asserts a passthrough; the underlying shape varies per provider.
- Bulk-operation responses (`copySeason`, `importMembers`) share a single `JsonObjectSchema` despite emitting two distinct shapes.
- `BeforeState` / `AfterState` in audit entries are intentionally opaque (they're snapshots of arbitrary domain entities depending on the action category) but typed as `Record<string, unknown>` rather than as a tagged-union of entity snapshots.

### 2.4 Convention drift in the model

Per `rules/domain-model-conventions-rules.md`:

- **Soft-delete vs hard-delete** — most lifecycle entities (User, League, Squad, LeagueMembership) use `isActive` as a soft-delete flag. Contest uses an explicit `status` enum that includes `CANCELLED`. Rules approve both shapes for different use cases, but they're applied inconsistently — Contest uses a status field, ContestEntry uses... unclear (needs verification at DTO level).
- **Status vs isActive** — used together on the same entity in some places (e.g., `League.isActive` + lifecycle implicit through `joinPolicy`). Contest uses status only. The mix isn't always semantically distinct.

---

## 3. Contract surface inventory

The DTO surface is the wire-format spec. Each DTO either fully types the payload, partially types it (with `JsonObjectSchema` escape hatches), or fully passes through opaque records.

### 3.1 Per-DTO state

Sweep across `packages/shared/dto/*.dto.ts` for `JsonObjectSchema` or `z.record(z.unknown())` references:

| File | Sites | Notes |
|---|---|---|
| `common.dto.ts` | 1 | The definition: `export const JsonObjectSchema = z.record(z.unknown())`. Used as the escape hatch. |
| `admin.dto.ts` | 3 | Admin audit entry payload + metadata + requestBody — admin-only surfaces, lower priority |
| `history.dto.ts` | 1 | `HistoryObjectSchema = JsonObjectSchema` — every history payload is opaque |
| `ingestion.dto.ts` | 2 | `errorLog` + `odds` arrays are opaque element-wise |
| `scoring.dto.ts` | 1 | `config: z.record(z.unknown()).optional()` in the validated-scoring-config response |
| `participants.dto.ts` | 1 | `metadata: JsonObjectSchema` — provider-normalized metadata |
| `leagues.dto.ts` | 4 | `LeagueAuditEntryDtoSchema`, `LeagueDashboardResponseSchema.league`, `.contests`, `LeagueBulkOperationResponseSchema` |
| `contests.dto.ts` | 3 | `latestPerformance` + `beforeState` + `afterState` |

**Total: 24 distinct `JsonObjectSchema` / `z.record(z.unknown())` sites.** The defect surface from `pool-master-rop.14` covers 5 of these (in leagues.dto.ts and contests.dto.ts — the contest-area ones); the other 19 are not yet filed as defects.

### 3.2 Mapper coverage

`packages/core-api/src/mappers/` has mappers for: account-consent, account, auth, contest-management, contests, events, leagues, leagues-extra, notifications, participants, squads, standings, version. **Missing**: dashboard mapper (the dashboard handler emits domain objects directly), audit-entry mapper (the audit handler emits service objects directly), bulk-op mappers (the bulk handler emits service results directly), drafts mapper, scoring mapper.

Mappers that import `Record<string, unknown>` or accept it as input:
- `notifications.mapper.ts:5` — `mapNotificationToDto(notification: Record<string, unknown>)` — accepts opaque Prisma row; should accept a domain shape
- `contests.mapper.ts:72` — `latestPerformance: Record<string, unknown>` field in DTO type
- `account-consent.mapper.ts:1` — `mapConsentRecordToDto(record: Record<string, unknown>)` — same Prisma-row shape

### 3.3 Routes that emit domain objects without a mapper

- **`leagues/routes.ts:411–419 getLeagueDashboard`** — handler returns `dashboardService.getDashboard(id)` (`CommissionerDashboard | null`) directly. No mapper. DTO uses `JsonObjectSchema` for `league` and `contests` because the wire format isn't shaped.
- **`leagues/routes.ts:484, 501 copySeason / importMembers`** — handlers return `bulkService.copyLastSeason(...)` and `bulkService.importMembersFromCsv(...)` directly. Single shared `LeagueBulkOperationResponseSchema = JsonObjectSchema` masks two distinct shapes.
- **`leagues/audit-handler.ts`** — handlers return `{ entries: AuditLogEntry[] }` from `auditService.*` directly. DTO uses `JsonObjectSchema` for entries. *(Resolved post-audit by PR #21 / rop.14.1: typed `LeagueAuditEntryDtoSchema` shipped + `mapLeagueAuditEntryToDto` applied at all three audit-log routes including `contests/routes.ts`. Section preserved for historical context — Phase 2 verifies the shipped shape against the redesigned pattern.)*
- **`history/*`** — full audit needed; `HistoryObjectSchema = JsonObjectSchema` blanket-opaque.
- **(Probably more)** — full audit per route would require enumerating every handler return.

### 3.4 The `api:check` + `api:validate` gates

As of PR #14 (rop.17, merged today):
- `api:check` enforces freshness — committed `openapi.json` matches what current source generates
- `api:validate` enforces priority-route quality — every route in the priority list has `operationId`, `summary`, `tags`, JSON response schema (passes 146 / 146 today)

**These do NOT detect `JsonObjectSchema` leakage.** A DTO that emits `z.record(z.unknown())` produces a valid OpenAPI spec (just an opaque object schema); the freshness check sees no diff; the validate check sees a real schema. The 24 sites slip through both gates.

---

## 4. State-mirroring patterns

Frontend state at `clients/poolmaster/src/`:

### 4.1 Zustand stores

| Store | Domain | Source of truth check |
|---|---|---|
| `features/auth/session-store.ts` | session user (`StoredPoolmasterSessionUser`) | **MIRRORS** the TanStack Query me-cache. The same user object is persisted into Zustand by `setSession()` calls scattered across login, refresh, account-update flows. Updates to the cache (e.g., a refetch returning different data) don't update the store; updates to the store don't invalidate the cache. |

(Only one Zustand store exists — auth/session.)

### 4.2 React Query cache

- **36 files** import `useQuery` / `useMutation` / `useInfiniteQuery`
- **68 distinct `queryKey` shapes** inline across the codebase
- Inline `queryKey: ['poolmaster', 'thing', id, ...]` everywhere; no centralized `query-keys.ts` factory
- Mutation invalidation is ad hoc — some mutations call `queryClient.invalidateQueries({ queryKey: [...] })`, some call `setQueryData({ queryKey: [...] }, updater)`, some don't update cache at all

### 4.3 Form-state mirroring

A repeating pattern across League/Contest/Entry edit pages:

```jsx
const [draftField, setDraftField] = useState(initial);
useEffect(() => { setDraftField(query.data?.field ?? initial); }, [query.data]);
```

The `useEffect` overwrites the user's in-flight edits whenever the query refetches. This was filed as `pool-master-rop.20` and PR #7 fixed three specific instances (league-detail-page, my-team-page, contest-entry-page) with seed-on-modal-open + identity-key guards. **The pattern's existence elsewhere is not gated by a scanner** — `scripts/check-form-query-mirror.mjs` is the warn-only baseline, but it doesn't catch every variant.

### 4.4 Optimistic updates and rollback

Spot-check: most mutations don't do optimistic updates today. The few that do (e.g., toggling commissioner role) update React Query cache directly via `setQueryData`. There's no documented rollback pattern when a mutation rejects — the cache remains optimistically-updated until the next refetch.

### 4.5 Where frontend state matters most for the substrate

The Contest Entry edit flow is the biggest hot spot:

- The user edits picks (UI state)
- Picks save via mutation → backend persists
- A score event lands during editing → backend recomputes entry score → React Query cache for that entry is stale
- Without explicit invalidation, the user sees stale standings/score on the contest detail page even after their pick changed
- Form-state mirroring on the same page can also overwrite their in-progress edit on refetch

Three substrate concerns intersect here: (a) the contract for "what's the current entry shape" is partly opaque (`latestPerformance`), (b) the cache invalidation isn't systematic, (c) the form state pattern can lose user input.

---

## 5. Scoring pipeline mechanics

Two services, sometimes overlapping, sometimes covering different surfaces.

### 5.1 Stat-event-driven path (real-time)

- `IngestionScheduler.pollLiveScores(sport, eventId)` — admin-triggered or scheduled
- Adapter returns `ProviderStatEvent[]` — one event per (participant, stat type, value)
- `publishStatEvents(events)` emits `'stat.received'` on the EventBus per event (`score-publisher.ts:13`)
- `subscribeStatEventConsumer(deps)` — single subscriber, in-memory event bus (`stat-event-consumer.ts:119`)
- For each `'stat.received'`:
  - `ContestLookup.findActiveContestsForProviderParticipant(providerId, providerParticipantId)` — DB query per event
  - For each active contest: invoke the contest's scoring engine, persist the entry score
  - Publish `'score.updated'`

**Mechanics worth noting:**

- **No dedup across events** for the same (contest, entry) — a single stat update for a contest with 50 entries triggers 50 entry-score writes serially.
- **No batching** — 100 stat events = 100 `findActiveContestsForProviderParticipant` queries against Postgres.
- **No outer transaction** at the contest level — partial scoring failures leave the contest in a mixed state.
- **No backpressure** — if stat events arrive faster than the consumer processes, EventBus's in-memory queue grows.

### 5.2 Recalculation path (admin-triggered)

- `ContestScoringRecalculationService.recalculateContest(contestId)` (`contest-scoring-recalculation-service.ts:46`)
- Walks every entry, invokes scoring engine, persists each entry score
- Used after configuration changes (tier, scoring config) or after the user requests a manual re-tally

**Mechanics:**

- Iterates entries in a `Promise.all`-style loop — 1+ Prisma queries per entry
- Uses `replaceEntryScoringResult` which is a `delete-then-create` transaction (concurrency hazard if two recalcs run simultaneously)
- Assigns ranks at the end of the loop

### 5.3 Standings rollup (periodic + on-demand)

- `StandingsRollup` class (`standings-rollup.ts:37`) wired up at `core-api/src/index.ts:95`
- `rollupContest(contestId)` — selects entry totals → computes ranks via `assignRanks` → persists `Standings` rows → publishes `'standings.updated'`
- `rollupAll()` — queries all active contests and rolls them up
- `startPeriodicRollup()` is called in `core-api/src/index.ts:256`; `stopPeriodicRollup()` in graceful shutdown at `:297`

**The duplication:** ranks are assigned in **both** the recalc service AND the rollup. If recalc finishes assigning ranks but rollup runs before the recalc-emitted `'score.updated'` events have all landed, rollup sees a partial state and reassigns ranks. The two rank-assignment paths can disagree under load.

### 5.4 Race conditions and concurrency

| Scenario | Risk | Mitigation today |
|---|---|---|
| Two stat events for same (contest, entry) arrive concurrently | Both fire scoring engine, last writer wins, intermediate value lost | None — no per-(contest, entry) lock |
| Recalc and rollup running concurrently on same contest | Rank reassignment conflicts | None — no contest-level lock |
| Recalc's `delete-then-create` mid-stat-event | Stat event reads gap state | None — no transactional guard |
| Stat events arriving during contest LOCKED/COMPLETED transition | Score updates leak across the state line | None — no status-gating |

### 5.5 Timing assumption: scoring is "eventually consistent"

The system implicitly assumes:
1. Stat events arrive at slow-enough cadence that the consumer drains the queue between events
2. Recalc is rare and admin-triggered, not concurrent with live ingestion
3. Periodic rollup is idle by the time scoring writes finish

None of these are enforced by the code. They held true while the sport providers in scope were the mock provider only.

---

## 6. Provider integration

### 6.1 Adapters

5 adapters in `packages/core-api/src/modules/ingestion/adapters/`:

- `mock-contest-feed-adapter.ts` — exercises the mock service over HTTP (the only one wired in CI / dev)
- `odds-api-adapter.ts` — the-odds-api.com integration
- `openf1-adapter.ts` — F1 telemetry
- `pga-tour-adapter.ts` — PGA Tour leaderboards
- `espn-adapter.ts` — ESPN sports data

Each implements `provider-interface.ts` (currently `getUpcomingEvents`, `getEventDetails`, `getParticipants`, `getRankings`, `getLiveScores`, `getEventResults`, `healthCheck`).

### 6.2 Provider registry / binding

- `provider-registry.ts` — runtime lookup table keyed by `providerId`
- `provider-bindings.ts` — `registerConfiguredProviders()` reads env, registers adapters

### 6.3 The mock-feed-provider parallel SDK

`packages/mock-contest-feed-provider/openapi-ts.config.ts` generates a hey-api SDK at `packages/mock-contest-feed-provider/generated/hey-api/*`. **No consumer imports it** — `mock-contest-feed-adapter.ts:355` does a raw `fetch()` and `lines 17–124` define hand-rolled local interfaces (`ScenarioSummaryResponse`, `EventListResponse`, `EventDetailResponse`, `FeedSnapshotResponse`, `ContestantRecord`, `ContestantDelta`) that duplicate what the generated SDK would have given. The generator output is dead.

### 6.4 Cross-provider normalization (or lack thereof)

`ProviderStatEvent` is the shared event shape on the bus. Each adapter maps its provider's response to `ProviderStatEvent` independently. There's no validation step on the bus boundary — the consumer just trusts the shape.

`latestPerformance` (per-entry, attached to a `RosterPick`'s `Participant`) is `Record<string, unknown>` — `normalizeLatestPerformance` in `contests/service.ts:1219` is just a type-assertion passthrough. Different sports have wildly different "performance snapshot" shapes (golf has rounds + holes + strokes; F1 has lap times; soccer has goals + assists + minutes); the contract pretends they're all the same opaque blob.

### 6.5 Strict-runtime guard

`provider-bindings.ts` had `isStrictRuntimeEnvironment(env)` — partially fixed under `pool-master-rop.5` (closed) which added env-var enforcement. Mock provider is now blocked in production / staging unless `SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON` is set.

### 6.6 Provider integration gaps

| Gap | Effect |
|---|---|
| No canonical `LatestPerformanceSnapshotDto` across providers | Frontend can't display a typed performance summary; each consumer has to know which fields to read per sport |
| Generated mock-feed SDK is dead code | TypeScript can't catch contract drift between mock service and adapter; only runtime errors do |
| `ProviderStatEvent` is loosely typed at the bus boundary | Bad/missing fields surface as scoring engine errors, not validation errors |
| Adapter `healthCheck` results don't feed into a circuit breaker | A failing provider keeps getting polled; backoff is per-adapter ad hoc |

---

## 7. Test coverage map

### 7.1 Suite-level totals (post merge of #14, #15, #16, #17)

| Suite | Files | Tests | Coverage threshold | Required pre-push gate? |
|---|---|---|---|---|
| Backend unit (`tests/unit/`) | 62 | ~592 | 24% / 14.2% / 21.15% / 24.53% (statements / branches / functions / lines — regression floor, not target) | Yes |
| Backend integration (`tests/integration/`) | 17 | (variable) | none | Yes |
| Backend functional / FAPI (`tests/functional/`) | 10 | ~60 | none | Yes |
| Webapp unit / vitest (`clients/poolmaster/src/`) | 92 | ~285 | none | Yes |
| Webapp E2E / Playwright (`clients/poolmaster/e2e/`) | 5 | (variable) | N/A | CI-only |

### 7.2 Coverage of the substrate paths

**Live-scoring write path:**
- Scoring engine — well-tested at unit layer (`tests/unit/core-api/scoring-service.test.ts`, contest-entry-scoring-result-service tests, etc.)
- Stat-event consumer — partial integration coverage (`tests/integration/core-api/contest-scoring-recalculate.integration.ts`)
- StandingsRollup — partial coverage; periodic loop not exercised end-to-end
- **No FAPI test that walks `mock-feed → ingestion → scoring → standings` end-to-end** — the path that matters most has no integration regression detector

**League / Contest / Entry CRUD paths:**
- FAPI suites cover: leagues, contests, drafts, squads, account, auth, consent, client-logs, root-admin, standings-history-consent — most user-facing routes have at least a happy-path FAPI test
- Negative paths (permission denied, contest in wrong state, etc.) are partially covered

**Frontend page-level tests:**
- 92 vitest files exist
- **30 of them call `vi.mock('@/lib/api', ...)` at module level**, replacing the entire generated SDK with hand-rolled `vi.fn()` factories. The auth-retry, CSRF, trace-id wiring in `clients/poolmaster/src/lib/api.ts` is untested at the page-test layer.
- No MSW handlers anywhere — `grep -RlE "msw|setupServer|http\\." clients/poolmaster/src` returns 0
- The recently-merged rop.21.1 cleared `clients/poolmaster/src/lib/` traceability findings; broader test traceability scanner still reports baseline finding count

**E2E:**
- 5 Playwright tests against the deployed QA frontend
- Auth setup project + chromium project
- Push-to-main only (not on PR)

### 7.3 What's not tested

- **Concurrent scoring scenarios.** Two stat events for the same (contest, entry) arriving back-to-back, recalc + rollup overlapping, status transitions during ingestion — none exercised.
- **Provider failure modes.** Adapter throws, returns malformed `ProviderStatEvent`, returns empty array — not exercised.
- **Cache-invalidation edge cases.** Mutation succeeds but invalidates wrong key, mutation fails and optimistic update isn't rolled back — not exercised.
- **State-mirror hazard on previously unfixed pages.** rop.20 closed three specific pages; the pattern's existence on other pages isn't caught by the warn-only `check-form-query-mirror.mjs`.
- **Audit log shape.** `LeagueAuditEntryDtoSchema = JsonObjectSchema`; no test verifies the actual fields the UI reads.

---

## 8. Cross-reference table — substrate findings ↔ existing defect IDs

This section is written **after** sections 1–7 so the audit's framing isn't shaped by the existing defect cluster's pre-investigated symptoms. The table maps the audit's findings (LEFT) to existing `pool-master-rop.*` defects (RIGHT). Audit findings without a defect ID indicate gaps that should be filed; existing defects without a finding row indicate symptoms whose root causes the audit has now reframed.

### 8.1 Mapping table

| Audit finding | Existing defect(s) | Notes |
|---|---|---|
| `JsonObjectSchema` leakage in 24 DTOs (`§3.1`) | `pool-master-rop.14` (umbrella, parent of .1 / .2 / .3 / .4 / .5; covers 5 of the 24 sites) | Existing defect covers only the contests + leagues area sites. **19 other sites unfiled** in admin / history / ingestion / scoring / participants / common DTOs. |
| Routes emit domain objects without a mapper (`§3.3`) | (none directly) | Symptom of the broader contract-first gap; should be filed as a new defect or absorbed into rop.78's design phase. |
| Audit log DTO opaque (`§3.1`, `§2.3`) | `pool-master-rop.14.1` *(shipped)* | Shipped post-audit via PR #21 — typed `LeagueAuditEntryDtoSchema` + mapper at all three audit-log routes. Phase 2 verifies post-redesign compliance. |
| Dashboard payload opaque (`§3.1`, `§3.3`) | `pool-master-rop.14.2`, `pool-master-rop.14.3` | Needs canonical dashboard-summary DTO design. |
| Bulk-op payload single opaque schema for 2 shapes (`§3.1`) | `pool-master-rop.14.4` | Needs split / discriminated union / generic envelope decision. |
| `latestPerformance` opaque + provider passthrough (`§2.3`, `§3.1`, `§6.4`) | `pool-master-rop.14.5` (DTO angle), `pool-master-rop.16` (provider SDK angle), `pool-master-rop.1` (ingestion-scoring decoupling) | All three converge on "no canonical cross-provider performance shape." |
| Zustand session-store mirrors React Query me-cache (`§4.1`) | `pool-master-rop.18` | Duplicate source of truth. |
| Form-state overwrite-on-refetch pattern (`§4.3`) | `pool-master-rop.20` (closed PR #7), pattern exists elsewhere | Three pages fixed; broader sweep needed. |
| Inline `queryKey` arrays everywhere; no factory (`§4.2`) | (none) | Should be filed; fits q8h.A2 (planned). |
| `vi.mock('@/lib/api')` in 30 frontend tests (`§7.2`) | `pool-master-rop.4` (P0) | MSW migration is the canonical fix per rop.4's suggested fix. |
| No FAPI test for `mock-feed → scoring → standings` path (`§7.2`) | `pool-master-rop.15` | The integration regression detector for the pipeline is missing. |
| Scoring pipeline race conditions (`§5.4`) | `pool-master-rop.7`, `.8`, `.11`, `.12`, `.1` | All are symptoms of the same substrate: no per-contest lock, no transactions, no dedup, dual rank-assignment paths. |
| Mock-feed-provider hand-rolled SDK / generated SDK dead (`§6.3`) | `pool-master-rop.16` | Either consume the generated SDK or delete it. Decision blocks on Phase 2. |
| Component / list-rendering fragility (e.g., index-as-key) (general frontend) | `pool-master-rop.62` (closed PR #15) | One pattern fixed; broader sweep tracked under `pool-master-q8h` epic. |
| Hand-rolled DTO slices in frontend (`§3.2` notifications, account-consent mappers; previously auth-home-page) | `pool-master-rop.65` (closed PR #9) | The Pick-from-generated-SDK pattern is established; broader sweep tracked under q8h. |
| Audit traceability + test discipline gaps (`§7.2`) | `pool-master-rop.4`, `.10`, `.21`, `.22`, `.23`, `.71` | All under the `rop.71` epic. |
| **NEW** — Cross-provider `LatestPerformance` normalization | (none) | Not directly filed as a standalone defect; `rop.14.5` references it but the FIX is upstream provider work. |
| **NEW** — Per-contest scoring lock for concurrent stat events | (none directly) | Implicit in `rop.7` / `.8` / `.11` / `.12` but the design is its own line item. |

### 8.2 Defect fold / redefine recommendations

Phase 2 should decide whether each in-scope defect:
- **Folds into a Phase 4 slice** — defect closed by an implementation PR
- **Is redefined** — scope shifts based on the redesigned shape
- **Stays independent** — symptom-level fix that doesn't depend on the substrate redesign
- **Is deferred** — not addressed in this epic

**Audit's preliminary lean** (Phase 2 confirms / overrides):

- `rop.14.1` — **shipped** via PR #21 (merged 2026-05-05); Phase 2 verifies the shipped shape complies with the redesigned pattern, with a follow-up Phase 4 slice if it doesn't
- `rop.14.2 / .3 / .4 / .5` — **fold into Phase 4 slices** that adopt the redesigned dashboard / bulk-op / performance shapes
- `rop.18` — **fold into Phase 4** (state-mirror cleanup; need new pattern for Zustand-as-ephemeral-only)
- `rop.20` (closed) — pattern recurrence sweep is **q8h-7wj.7 backsweep**; rop.78 doesn't re-open
- `rop.4` — **stay independent under rop.71 epic** (MSW migration is its own track but informed by the new DTO shapes)
- `rop.10` — **stay independent under rop.71 epic** (test traceability annotation work, mechanical)
- `rop.21 / .22 / .23` — **stay independent under rop.71 epic**, but the audit's cross-reference table makes them better-scoped
- `rop.7 / .8 / .11 / .12` — **fold into Phase 4** (scoring pipeline redesign — single per-contest lock, transactional recalc, debounced stat-event consumer)
- `rop.1` — **fold into Phase 4** (the load-bearing substrate fix; "live scoring path decoupled from production scoring path" is THE central seam)
- `rop.16` — **fold into Phase 4** (provider SDK strategy decision; affects all adapters)
- `rop.62 / .65` (closed) — symptom-level fixes already shipped; pattern recurrence handled by q8h epic
- `rop.71.1` (just closed) — separate test-infrastructure track; not part of substrate
- `rop.76.1` (security) — separate track (deferred security epic); not in scope

---

## 9. Open questions for Phase 2

The design plan (`plans/<NN>-league-contest-substrate-redesign.md`) must resolve these decisions. Listed in dependency order — earlier questions block later ones.

**Scope and identity:**

1. **What's the canonical "League summary" DTO?** Today the same domain `League` is exposed via `LeagueSummaryDtoSchema` (lists), `LeagueDetailDtoSchema` (detail page), `JsonObjectSchema` inside `LeagueDashboardResponseSchema.league` (dashboard). Should we collapse to one shape, keep three purpose-specific shapes, or define a "view-model envelope" pattern?

2. **What's the canonical "Contest summary" DTO?** Same question for contests. Today there are at least 3 different consumer needs: list view, detail view, dashboard. Each could be its own DTO or one shape with optional fields.

3. **What's the canonical `ContestEntry` DTO including `latestPerformance`?** This is the hottest read path; getting the shape right ripples to every frontend consumer.

**Scoring pipeline:**

4. **Single locking strategy for concurrent stat events?** Per-contest pessimistic lock (advisory), optimistic concurrency control with retry, or single-writer pattern via a queue? Affects `stat-event-consumer.ts`, recalc service, rollup.

5. **Recalc + rollup unification?** Either kill the periodic rollup and rely on stat-event-driven updates, or kill the recalc-time rank assignment and rely on rollup. Two rank paths today disagree under load.

6. **Transaction boundary for per-stat-event scoring?** Today: no outer transaction; partial failures leave mixed state. Move to "all entries for this stat event in one transaction" or "per-entry retry on conflict"?

7. **Debouncing / batching of stat events?** A single stat update for a 50-entry contest fires 50 entry-score writes today. Should the consumer batch by contest within a short window?

**Provider integration:**

8. **Canonical `LatestPerformanceSnapshotDto` shape?** Tagged-union per sport (`{ sport: 'GOLF'; rounds: [...] } | { sport: 'F1'; lapTimes: [...] }`), or a generic `{ summaryFields: { label, value, format }[] }` shape? Affects every adapter.

9. **Mock-feed-provider SDK strategy?** Consume the generated SDK in `mock-contest-feed-adapter.ts` (delete the hand-rolled interfaces), or delete the generator config (mock provider is intentionally HTTP-only at its boundary)? rop.16's open question.

10. **`ProviderStatEvent` validation at the bus boundary?** Add Zod parsing in `score-publisher.publishStatEvents` so malformed events surface as validation errors rather than scoring engine crashes?

**Frontend state:**

11. **Zustand vs React Query split?** Audit recommends "React Query owns server data; Zustand owns ephemeral UI state ONLY." Need to decide how to migrate the session-store off the duplicated me-cache.

12. **Per-feature `query-keys.ts` factory?** Codify the pattern, replace 68 inline shapes. Already planned under `pool-master-q8h.A2`; design should specify the structure (e.g., `LeagueQueryKeys.detail(code)`).

13. **Cache-invalidation contract?** Every mutation should declare which keys it invalidates. Today this is ad hoc. Should be enforced by lint or by a hook wrapper?

**Test coverage:**

14. **MSW migration strategy for the 30 `vi.mock('@/lib/api')` sites?** Big-bang vs page-by-page. rop.4 lives in epic rop.71; the audit may accelerate it.

15. **End-to-end FAPI test for the live-scoring pipeline?** The defect rop.15 names this; design phase should specify the scenario (which provider scenario, which contest config, which assertion points).

**Cross-cutting:**

16. **Re-parent existing rop.* defects under rop.78?** Phase 3 decision per the umbrella epic. Audit's lean is in §8.2 above.

17. **Slice ordering for Phase 4?** Dependency analysis: which redesigned shape blocks which downstream slice? Likely order: (a) cross-provider performance shape → (b) DTO redesign → (c) mapper layer → (d) per-contest scoring lock → (e) rollup vs recalc unification → (f) frontend state-layer split → (g) test coverage closure.

---

## Audit complete — paused for review

Phase 2 (the design plan) does NOT auto-start. The user reviews this audit, pushes back on findings or framings, and signs off before Archie writes `plans/<NN>-league-contest-substrate-redesign.md`. Per `pool-master-rop.78` the gate is explicit.

**Next action when reviewing:** run through sections 1–7 and call out anything that seems wrong, missing, or framed in a way that biases toward a specific solution. Then hit section 9 — the design plan's quality is bounded by how well-decided those questions are.
