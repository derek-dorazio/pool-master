# Golf Tournament Admin — Sport-Organized Management Screens

> **Status:** In progress. **Beads epic:** `pool-master-476`. All 23 slices from §7 are
> created as child stories of that epic with `blocked-by` dependency links matching the
> table below (`bd show pool-master-476` for the live list, `bd ready` for what's actually
> unblocked right now). Slice status lives in Beads, not in this file — this file stays
> narrative only, per `plans/README.md`.
>
> **This is the trunk plan.** `plans/126` (epic `pool-master-jhb`), `plans/127` (epic
> `pool-master-wsu`), and `plans/128` (epic `pool-master-9oy`) are all downstream and gate
> their own start on specific slices here, not on this whole epic finishing — see §7's slice
> table for the full dependency graph. Concretely: `plans/126`'s epic has a real cross-epic
> `blocked-by` link on slice 1 (`pool-master-uvc`) only; `plans/127`'s and `plans/128`'s
> epics each have one on slice 9 (`pool-master-piv`) only (the `drafts/routes.ts` tier/price
> rewiring) — not on this epic's full slice sequence.
>
> **Testing policy — applies to every slice in this epic and in the three downstream
> epics above.** Tests are part of a slice's implementation, not a follow-up; a slice is
> not done until they exist and are green:
> - **Update every existing test the slice touches** — fixtures, mocks, assertions —
>   so the suite passes for real, not just compiles. Renaming or reshaping something
>   this epic already shipped means finding and fixing every test that assumed the old
>   shape, not only the ones that happen to fail loudly.
> - **New code gets direct unit test coverage**, including new pure functions, new
>   branches inside existing functions, and new conditionals — the failure/false/
>   alternate path needs its own assertion, not just the happy path.
> - **Don't duplicate tests across call sites, and don't copy-paste a branch of logic
>   into multiple call sites and leave it untested — refactor to one testable unit
>   instead.** The moment the same conditional/derivation appears in a second place,
>   extract it to one named function and give *that function* the full branch
>   coverage, once. Each call site's own test then only needs to prove it actually
>   calls that shared function (e.g. `jest.spyOn` the shared module and assert the
>   call), not re-verify every branch again — a second, silently-diverging copy of
>   the same logic is the failure mode this prevents.
> - **Every new route/operationId gets contract-verification coverage.** Where a
>   slice's own row in the §7 slice table is (or feeds) the epic's FAPI scenario, that
>   FAPI coverage lands in the same slice, not a deferred one.
> - **Any slice that changes an existing API's request/response shape must update
>   every existing FAPI scenario that exercises it in the same slice** — a passing
>   FAPI test that silently stopped asserting the changed field is worse than a
>   failing one.

---

## 1. Context

PoolMaster can only get a golf tournament into a usable state through the ingestion
pipeline. Every field, odds, ranking, tier, score, and lifecycle transition is written by
`IngestionPersistence` from a provider payload — today the mock Data Golf feed. There is
**no admin write path into golf domain state at all**: no endpoint locks a field, sets an
event status, edits a tier, or corrects a score. The only admin mutations that touch
contest state are `contests/override-service.ts` (reopen/complete a contest) and
participant mapping/merge.

That makes every product demo, QA pass, and league dry-run hostage to the mock provider's
clock-driven simulation (`packages/mock-contest-feed-provider/src/scenario-store.ts`) and,
later, to a real Data Golf subscription.

This plan adds a root-admin authoring lane so a tournament can be created, fielded, seeded,
tiered, opened, and locked entirely by hand. Setup and field data stop depending on sync —
but **live scoring does not**: customers expect near-real-time score updates during a live
tournament, so scores must keep flowing from a scheduled sync (the mock provider for QA
today, a real provider later) even for a tournament whose setup was entirely hand-built.
The admin/sync boundary is therefore a per-event, per-feed toggle (§4.4), not a hard split
between "manual" and "provider" events. It also reorganizes `/manage` so sport-specific
management lives in a per-sport section, making basketball (and everything after) an
additive change rather than a reshuffle.

Two existing plans are directly upstream:

- **`plans/117`** — the typed substrate (`SportEvent` → `SportEventParticipant` →
  per-category detail tables). All new tables here follow its additive-substrate rule.
- **`plans/123`** — workflow gate hardening. Its slice `pool-master-5xi.1` ("introduce or
  consolidate a shared `SportEventStatus` constant") is a **hard prerequisite** here and is
  folded in as slice 1: an admin workflow screen cannot be built on a bare `String` column.

`plans/122` (`COMPLETED → OFFICIAL` closeout) is **not** a dependency of this plan and this
plan doesn't build toward it. `OFFICIAL` isn't implemented anywhere today — plan 122 is an
unbuilt proposal whose entire premise (a separate provider feed returning *corrected* results
sometime after completion) is weaker under this plan's admin-managed model: an admin-entered
or live-synced tournament's numbers are already final the moment it's marked Completed, with
no later correction to wait for. This plan's workflow rail stops at `Completed` (§6.3); the
`OFFICIAL` enum value is left alone at the platform layer (§4.1) since other, unrelated code
already references it, but nothing here exposes or depends on a transition into it.

---

## 2. Decisions locked with the user

| Question | Decision |
|---|---|
| Tier scope | **Event-level default; contest may override.** Tiers become a first-class per-tournament structure. Contests inherit by default; a commissioner can still customize for their own contest. |
| Manual vs. provider events | **Per-event `syncScope` (`NONE`\|`SCORES_ONLY`\|`FULL`), not a hard provider split** (§4.4). Setup/field/tiers/rankings are always admin-authored through this plan's tools. Live scores must still be able to sync in near real time, so an admin-created tournament can be **linked** to a real (or mock) provider's event for scores only, without ever letting sync touch schedule/field/rankings. |
| Score-source linking | **Browse a live picker of the provider's events.** A new thin admin endpoint exposes the sport's registered provider's catalog (`provider.getUpcomingEvents`); admin searches and selects one to bind for score polling (§4.4). |
| Scoring scope | **Setup + status + scores.** Manual bulk upload (paste/upload CSV or JSON) is the QA/testing path and remains available as a correction tool afterward. In production, near-real-time scores (30–60s cadence) come from the existing ingestion scheduler once a tournament is linked — this plan does not build a second scoring pipeline. |
| Menu shape | **Sports group with per-sport sections.** `/manage` gains a Sports grouping; `/manage/golf` is a golf hub with its own sub-pages. Platform sections (Leagues/Teams/Users/Sync) are unchanged. |
| League model | **`Sport → SportLeague → Season → SportEvent`, plus `Participant ←→ SportLeague` affiliation (not season-scoped — §4.2), built cross-sport, not golf-only** (§3.2). Basketball (NBA/NCAA Basketball/G League) and football (NFL/NCAA Football/CFL/XFL) reuse the identical tables and shared service; only this plan's golf route lane and golf-specific business logic (tiers, scoring) are golf-only. |

---

## 3. Architecture — three lanes

The user's constraint is: **admin APIs separate from sync APIs at the route level, converging
on shared business-tier code.** Today they are not separate — `/api/v1/admin/providers/*`
*is* the sync API, and the golf write logic is buried inside `IngestionPersistence` and
`score-publisher.ts` where only the ingestion path can reach it.

```
  ROUTE LANE                      SHARED BUSINESS TIER                    PERSISTENCE
  ──────────                      ────────────────────                    ───────────

  /api/v1/admin/sports/golf/*  ┐
  (new — authoring)            │
                               ├──►  modules/golf/  (golf-only)         ┐
  /api/v1/admin/providers/*    │       golf-field-service.ts            │
  (existing — sync ops)        │       golf-tier-service.ts             │
                               │       golf-score-service.ts            │
  IngestionScheduler           │       golf-seeding-algorithm.ts        │
  (scheduled + manual sync)    │                                        ├──►  Prisma
                               ├──►  modules/sport-catalog/ (cross-sport)│
  (future: /sports/basketball/*│       sport-league-service.ts          │
   /sports/football/* — reuse  │       (+ league-roster CRUD/upload)    │
   the same shared tier)       │       season-service.ts                │
                               │                                        │
                               ┘     modules/events/  (cross-sport)     │
                                       event-lifecycle-service.ts       │
                                       event-score-source-service.ts    ┘
```

This plan ships the `/api/v1/admin/sports/golf/*` route lane and `modules/golf/`. It also
ships `modules/sport-catalog/` and the two `modules/events/` additions as genuinely
cross-sport shared tiers — not golf-flavored — because `SportLeague`/`Season`/
`ParticipantLeagueAffiliation` (§4.2) and score-source linking (§4.4) are the same problem for
every sport with more than one governing body, not a golf-specific one. A future basketball or
football admin plan adds its own route lane and its own sport-specific service (mirroring
`modules/golf/`), calling into these same shared services rather than rebuilding them.

### 3.1 New backend module: `packages/core-api/src/modules/golf/`

Golf domain logic is **extracted from ingestion, not duplicated**. Both lanes call it.

| File | Extracted from / new | Responsibility |
|---|---|---|
| `golf-field-service.ts` | new, plus the participant-upsert half of `ingestion-persistence.ts:persistEventDetailWithDiagnostics` | Seed field from the tournament's linked **league's currently-active affiliated participants** (§4.2), deriving `seedNumber`/`oddsToWin` (§4.7); add/remove a golfer; set per-event `isActive`/`inactiveReason` / `worldRanking` / `oddsToWin` / `seedNumber` |
| `golf-seeding-algorithm.ts` | new, pure | Tie-broken rank position → `seedNumber`; position-derived, randomly-jittered `oddsToWin` (§4.7) |
| `golf-tier-service.ts` | replaces `derivePersistedTierConfig` in `contest-management/service.ts:477-550` | Define event tiers (defaulting to 6 tiers of 10, §4.5a — genuinely new logic, not a port; today's `defaultTierSize`/`tierSource` are decorative, §4.5), auto-assign from odds or world rank, manually reassign, read the effective tier set for a contest |
| `golf-score-service.ts` | wraps `persistGolfRounds` + `refreshGolfStandings`, extracted out of `ingestion/core/score-publisher.ts` | Apply a round's scores (bulk or single) by resolving `roundNumber → SportEventRound.id` (§4.10) then writing `SportEventParticipantGolfRound`, refresh `SportEventParticipantGolfStanding`, publish `live_score.persisted` |

### 3.2 New shared, cross-sport module: `packages/core-api/src/modules/sport-catalog/`

`SportLeague` and `Season` (§4.2) model a real-world hierarchy — governing body → year — that
applies identically to every sport with more than one league: golf (PGA Tour, LIV Golf, LPGA
Tour, Champions Tour), basketball (NBA, NCAA Basketball, G League), football (NFL, NCAA
Football, CFL, XFL). `ParticipantLeagueAffiliation` (§4.2 — replacing the earlier
`SeasonParticipant` draft) is the third table in this module: **league-scoped, not
season-scoped** — a golfer's tour membership doesn't reset every year, so it isn't modeled as
if it does. None of this CRUD or bulk-roster-upload logic is golf-shaped, so it does not live
in `modules/golf/`:

| File | Responsibility |
|---|---|
| `sport-league-service.ts` | `SportLeague` CRUD (create/list/update; `isActive` soft-lifecycle); `ParticipantLeagueAffiliation` CRUD + the bulk paste/upload/preview/apply flow (§5.2, §6.3) — league-scoped roster management lives here, not on `Season`, since the roster isn't a per-season concept |
| `season-service.ts` | `Season` CRUD, filterable by `sportLeagueId` (the "global list by league" — §4.2, §5.2); `cloneSeasonTournaments(seasonId, targetYear)` — re-creates each source-season tournament as a fresh shell in the new season (§4.2a) — no roster to clone anymore, so cloning a season is now purely a tournament-calendar convenience |

The golf-specific admin routes (`/sports/golf/leagues`, `/sports/golf/seasons`, …) are thin
wrappers over this module, scoping every call to `Sport = GOLF` (§5.2). A future basketball
admin plan adds `/sports/basketball/leagues` etc. over the identical service, filtered to
`Sport = BASKETBALL` — no new table, no new CRUD logic, just a new route lane and its own
sport-specific business module (mirroring `modules/golf/`) for whatever *is* basketball-shaped
(e.g. bracket seeding, conference tie-breakers — out of scope here, named only to show where
the line sits).

### 3.3 New shared service: `modules/events/event-lifecycle-service.ts`

This is the most important extraction. `IngestionPersistence` currently performs the
lifecycle **side effects** inline and privately:

- `activateContestsForStartedEvent` — event `IN_PROGRESS` → contests `OPEN|LOCKED` →
  `ACTIVE` + "contest started" emails
- `settleContestsForCompletedEvent` — event `COMPLETED` → `GolfContestSettlementService`

An admin-triggered transition must fire the **same side effects** as a provider-triggered one
— there must be exactly one code path for "what happens when a sport event's status changes,"
not a parallel admin version that can silently drift from it. Extract both into
`applySportEventStatusTransition({ sportEventId, toStatus, actor })`, which:

1. validates the transition against a new `SPORT_EVENT_STATUS_TRANSITIONS` const map
   (`packages/shared/domain/sport-event-lifecycle.ts`) with TypeScript exhaustiveness;
2. writes `SportEvent.status` (and `endsAt` on completion);
3. fires the same contest activation / settlement side effects;
4. writes an `AdminAuditEntry` when `actor.type === 'ROOT_ADMIN'`.

`IngestionPersistence` then calls this instead of doing the work itself. Provider-driven
transitions stay permissive (log-and-proceed on an unexpected jump, matching today's
unconditional upsert); admin-driven transitions are **strict** and return
`422 SPORT_EVENT_INVALID_TRANSITION`.

### 3.4 New shared service: `modules/events/event-score-source-service.ts`

The other cross-sport half of §4.4: linking an admin-authored `SportEvent` to a real
provider's live event for scoring. Lives beside `event-lifecycle-service.ts`, not in
`modules/golf/`, because nothing about it is golf-shaped — "browse the provider's catalog for
an event to link" is exactly as true for an admin-created NBA game or NCAA football game as it
is for a golf tournament. `listCandidateEvents(sport, dateRange, sportLeagueId?)` (§4.4 — no
scoring, no ranking, a plain filtered list, an earlier draft's `findCandidateMatches` scoring
algorithm deleted per the user's direction, not kept as a smarter option) and
`linkScoreSource`/`unlinkScoreSource` operate on the generic `SportEvent` columns
(`providerId`, `externalId`, `syncScope`) and the generic `Season.sportLeague` relation. Golf's
admin routes (§5.2) call this service exactly the way they call `event-lifecycle-service.ts`
for status transitions; a future basketball admin plan would do the same.

**This service is also the single place that resolves "which provider is registered for this
sport" for every read-only lookup the admin-golf module needs.** Every one of these needs the
same `providerRegistry.getProvider(sport)` resolution and the same "no provider configured for
this sport" failure mode: `adminListProviderCatalogEvents`'s browse (now the *only* candidate
lookup — see §4.4, the dedicated score-source-candidates operation is deleted, this one serves
both browsing-to-create and browsing-to-link), and (§4.4a)
`adminCreateGolfTournamentFromProviderEvent`'s `provider.getEventDetails(externalId)` call for
prefilling a new tournament's name/venue/dates. Centralizing both in
`event-score-source-service.ts`, rather than letting the admin-golf module resolve the provider
registry independently, means there is exactly one place that knows how to find "the" provider
for a sport and exactly one failure mode when none is configured — not multiple call sites that
could drift out of sync with each other or with `provider-service.ts`'s own resolution logic
for tracked syncs (§4.4a). This is the same lane-separation principle as §3's diagram, applied
to the read-only half: **tracked, ledger-recorded provider calls converge on
`provider-service.ts`/`syncEventData`; untracked, read-only provider lookups converge on
`event-score-source-service.ts`** — two clean convergence points, never a golf-specific
direct call to `providerRegistry` anywhere in `modules/golf/` or `modules/admin/golf/`.

### 3.5 Setup/field authority vs. score-sync eligibility (§4.4 has the schema)

`SportEvent.providerId` is `NOT NULL` with `@@unique([providerId, externalId])`, so every
tournament needs a `(providerId, externalId)` identity regardless of who authored it — but
identity and **sync eligibility** are no longer the same decision:

- A newly created tournament starts **unlinked**: `providerId = 'manual-admin'` (a reserved
  shared constant, `MANUAL_ADMIN_PROVIDER_ID` in `packages/shared/domain/providers.ts`),
  `externalId = manual-<uuid>` generated server-side, and `syncScope = 'NONE'`. No adapter is
  ever registered for `manual-admin`, so this placeholder identity cannot be scheduled or
  manually targeted by any sync route — this is the QA/testing default the user described
  ("I'll use the manual score upload to QA and test functionality").
- Root admin can **link** a tournament to a real provider's live event (§4.4) — the picker
  from the Q&A above browses `provider.getUpcomingEvents(sport, dateRange)` live, not the
  `SportEvent` table, so it works whether or not schedule/field sync is enabled at all.
  Linking rewrites `providerId`/`externalId` to the chosen provider event and sets
  `syncScope = 'SCORES_ONLY'`. From that point, the **existing** `IngestionScheduler`
  live-scores loop — already polling at a configurable interval via
  `/manage/sync-config/poll-intervals` (`eventLiveScores.intervalSeconds`, set it to 30–60) —
  picks the tournament up on its normal cadence. Nothing new is built for the actual
  near-real-time polling; it is the mechanism that already exists, gated to reach this event.
  **Linking does not, by itself, populate the field** — that would leave a linked-but-empty
  tournament looking like a dead end if this were the whole story. It isn't: §4.4a adds a
  second, equally common entry point (browse a provider event → create the tournament already
  linked, in one action) plus a standing **Load/Refresh Participant Field** action available on
  any linked tournament, which calls the provider's event-detail feed on demand and populates
  the field from it — auto-matching or auto-creating each golfer's global identity via
  `ParticipantProviderMapping`, never requiring the admin to link participants one at a time.
  Read §4.4a for the full mechanism before assuming this section's silence on field data means
  the admin has to build the field by hand after every link.
- Admin mutations to setup/field/tiers/rankings are gated by `assertAdminManagedEvent(eventId)`
  → `409 EVENT_NOT_ADMIN_MANAGED` whenever `syncScope === 'FULL'` (i.e. the row is fully
  provider-owned — the default for any `SportEvent` the ingestion pipeline itself created,
  preserving today's behavior with zero migration risk). `NONE` and `SCORES_ONLY` both remain
  fully admin-editable for setup/field/tiers — `SCORES_ONLY` only opens the door for the
  live-scores/results feeds, never schedule/field/rankings (§4.4). Provider-owned (`FULL`)
  events remain visible and read-only in the admin UI (the existing `/manage/events` browser
  already covers that).
- **Platform-wide feed deprecation stays a config change, not new code.** The existing
  `IngestionScheduleConfig` (`packages/core-api/src/modules/admin/ingestion-config-service.ts`)
  already has an independent `enabled` flag per feed (`eventSchedule`, `eventParticipants`,
  `participantRankings`, `eventLiveScores`, `eventResults`) plus `perSportOverrides`, exposed
  today at `/manage/sync-config`. When this plan's tooling is trusted enough to fully retire
  schedule/field/rankings sync for golf, that is a toggle on an already-built screen — turn
  those three off for `GOLF`, leave `eventLiveScores`/`eventResults` on. `syncScope` is what
  makes that safe to do gradually: it protects an individual admin-managed tournament's field
  even before the sport-wide toggle is flipped, and it means a still-provider-owned (`FULL`)
  legacy event and an admin-managed, score-linked (`SCORES_ONLY`) tournament can coexist
  during the transition. **`plans/125-sync-flow-deprecation.md` takes this further**: rather
  than a someday-maybe toggle, it flips `eventSchedule`/`eventParticipants`/
  `participantRankings` to `enabled: false` by default platform-wide (not just per-sport),
  since admin-authored events (this plan) make schedule-driven event creation redundant for
  every sport, not just golf — see that plan for the full analysis, including why
  `EVENTSCHEDULE` also owns `SportEvent.status` transitions today (a detail that matters for
  why it's safe to disable once admin drives status manually, §3.2 above). It also adds a
  bulk "Field Participant Data Upload" capability to this plan's Field section (§5.2, §6.3) —
  a fourth field-population path, alongside seeding from the league roster (§4.7), adding one
  golfer at a time, and the now-optional provider sync — for externally-sourced field/odds
  data (e.g. copied from the tournament's own website).

### 3.6 New shared service: `modules/events/event-lifecycle-scheduler.ts`

The admin workflow rail (§6.3) already lets a human drive every status transition. This adds
a second, automatic caller of the *exact same* `applySportEventStatusTransition` (§3.2) — not
a parallel status-writing mechanism, the same one-code-path rule that motivated §3.2 in the
first place applies here too. A lightweight recurring sweep on a fixed **5-minute interval**
(its own interval — no provider involved, so it does not belong in `IngestionScheduler`;
platform-wide, not admin-configurable per tournament — confirmed §9), scoped to admin-managed
events only (`syncScope != 'FULL'`, §4.4 — a still-provider-owned legacy event's status
remains exclusively the provider's to set, unchanged from today):

- `status = SCHEDULED` and `now >= ` the tournament's first `SportEventRound.scheduledDate`
  (§4.10; falls back to `SportEvent.startDate` if rounds aren't populated) →
  `applySportEventStatusTransition(..., toStatus: 'IN_PROGRESS', actor: { type: 'SYSTEM',
  reason: 'SCHEDULED_LIFECYCLE' })`.
- `status = IN_PROGRESS` and `now >= ` the last `SportEventRound.scheduledEndAt` (falls back to
  `SportEvent.endDate`) → the same call with `toStatus: 'COMPLETED'`.
- Skipped entirely when `SportEvent.autoLifecycleEnabled = false` (§4.10) — the admin's manual
  override for a rain delay, a dispute, or any other reason the recorded schedule no longer
  reflects reality.

**"Field locked" needs no new code.** It's easy to assume this scheduler also has to flip a
stored "locked" state, but `evaluateEventOperationalState` (`operational-timing.ts:90`) already
computes field-lock status **at read time** by comparing `now` against `fieldLocksAt` — it's
derived, never a stored transition, and this already works identically for admin-managed and
provider-owned events today. The scheduler's job is exactly the two status writes above,
nothing else.

This is what makes the user's summary literally true, not just a design intention: **status —
whichever caller sets it, admin or this scheduler — is what already gates sync calls.**
`scheduled-event-reader.ts`'s `EVENTPARTICIPANTS` query already only selects `status =
'SCHEDULED'` events (pre-existing, unrelated to this plan), and its `EVENTLIVESCORES` query
already only selects `status IN ('IN_PROGRESS')` (also pre-existing) — both combine with the
`syncScope` gate this plan adds (§4.4). Field sync was already going to stop the moment status
left `SCHEDULED`, and score sync was already going to wait for `IN_PROGRESS` — this scheduler
just means that moment can arrive without an admin click, if the recorded schedule says it
should.

A system-driven transition still writes an audit record (§9 flags the open question of exactly
which table/shape) distinguishable from a `ROOT_ADMIN`-actor one, so "why did this tournament
go Live" is always answerable regardless of which caller triggered it.

---

## 4. Data model changes

Per `rules/model-change-rules.md` this is a true model change — Dom gates it before Brad
implements. Per `rules/domain-model-conventions-rules.md` §11 every change is **additive**
except the two enum promotions, which are typing fixes to existing columns.

### 4.1 Enum promotions (folds in `pool-master-5xi.1`)

```prisma
enum PrismaSportEventStatus { SCHEDULED IN_PROGRESS COMPLETED CANCELLED POSTPONED }
enum PrismaGolfParticipantInactiveReason { WITHDRAWN CUT ELIMINATED }
```

**`OFFICIAL` is dropped, not carried forward.** Verified every remaining real reference —
`scheduled-event-reader.ts:73`'s `EVENTRESULTS` eligibility filter, `provider-interface.ts`'s
`ProviderEventResult.status`, and the mock adapter's `getEventResults` mapping — belongs to
exactly the `EVENTRESULTS`/`ProviderEventResult` pipeline `plans/125` §3.3a deletes entirely.
Once that lands, nothing reads or writes `OFFICIAL` anywhere; `plans/122`'s
`COMPLETED → OFFICIAL` workflow that would have needed it is already dropped (§1). Keeping an
enum value with zero writers "for symmetry" is exactly the kind of stubbed-out residue this
whole conversation has been removing elsewhere — five values, not six.

**`SportEventParticipant`'s status becomes a boolean gate plus an optional reason, not one
seven-value enum — because that's what the real write path already does today, just disguised
behind a bigger enum than it actually produces.** Verified by reading
`IngestionPersistence`'s existing per-event participant upsert
(`ingestion-persistence.ts:626-651`, the exact code `golf-field-service.seedFieldFromProvider`
extracts, §4.4a): it writes `status: participant.active ? 'ACTIVE' : 'INACTIVE'` — a **binary**
outcome, always. `WITHDRAWN`/`CUT`/`ELIMINATED` are never written by sync at all; only an
admin's own manual edit (§6.3's Field editor) could ever produce them, as a richer *reason* the
admin knows and sync doesn't. Modeling that as one flat enum forces every consumer that only
cares "is this golfer in the pool" to enumerate all the non-active values by hand — exactly the
"if not(ACTIVE)" ambiguity that prompted this review. Splitting it removes the ambiguity
structurally instead of documenting it:

- `SportEventParticipant.isActive: Boolean @default(true)` — the real gate. Every "is this
  golfer eligible/available" check anywhere (pick eligibility, tier auto-assign, the Add More
  Participants exclusion list, §6.3) reads this one field, never a `status`/`reason` value.
- `SportEventParticipant.inactiveReason: PrismaGolfParticipantInactiveReason?` — nullable,
  meaningful only when `isActive = false`; `null` covers both "still active" and "inactive, no
  more specific reason recorded" (replacing the old bare `INACTIVE` enum value, which is now
  redundant with `isActive = false` + `inactiveReason = null`). Purely descriptive — display
  and admin-facing tracking only, read by nothing that gates behavior.

**`PROVISIONAL` and `ALTERNATE` are dropped, not folded into the reason enum.** Verified zero
references anywhere in `packages/core-api/src` or `packages/shared` outside their own
declaration in the mock provider's `participantStatusKinds` — and even there, the adapter's
existing active/inactive determination (`active: !['withdrawn', 'inactive', 'eliminated',
'cut'].includes(...)`) already excludes only four raw values, meaning `'provisional'`/
`'alternate'` are *already* treated as active today. Dropping them from PoolMaster's own domain
enum changes nothing about current behavior; it just stops the enum from implying a distinction
that was never acted on.
- Domain source of truth: new `SportEventStatus` / `GolfParticipantInactiveReason` const
  objects in `packages/shared/domain/enums.ts`, alongside the existing `ContestStatus`.
- `EventStatusDtoSchema` (`packages/shared/dto/events.dto.ts:10`) currently lists all six
  values including `OFFICIAL` — trim to five and derive from the domain constant rather than
  restating a literal list, matching `plans/125`'s `EVENTRESULTS` deletion (coordinate the two
  slices; whichever lands first, both touch this same code).
- **Mock provider mapping is no longer 1:1** — it wasn't functionally 1:1 with real behavior
  even before this change (see above), it's now explicit instead of implicit. The adapter maps
  the mock's 7 raw `participantStatusKinds` values down to `{ isActive, inactiveReason }`:
  `active`/`provisional`/`alternate` → `isActive: true`; `withdrawn` → `isActive: false,
  inactiveReason: WITHDRAWN`; `cut` → `isActive: false, inactiveReason: CUT`; `eliminated` →
  `isActive: false, inactiveReason: ELIMINATED`; `inactive` → `isActive: false, inactiveReason:
  null`. The mock package itself is untouched — its own contract is intentionally richer than
  what PoolMaster's domain needs to model, the same "provider payload isn't a schema authority"
  principle §4.4a already applies to round-schedule derivation.
- Sweep the bare literals flagged in plan 123, notably `scheduled-event-reader.ts:71-73`.

### 4.2 League roster (not season-scoped) and the current-season pointer

Today, creating a tournament means entering every golfer's field status, world rank, odds,
and seed one at a time (or, on the sync side, waiting for a provider). The user wants a single
source — "PGA Tour" — that holds the full player pool and current world ranking once, so
creating a tournament seeds from it instead of re-entering data.

An earlier draft of this plan scoped that roster to *season* (`SeasonParticipant`, one row set
per year). Revisited: real tour rosters are ~95% stable year to year — a handful of retirements
and rookies, not a wholesale turnover — and nothing in this plan actually needs a *historical*
snapshot of who was on which roster, or what a golfer's ranking was, as of a past season.
Ranking already changes weekly within a season and every update already overwrites the prior
value with no history kept — scoping the table to `Season` never actually protected any
history, it just added a copy-forward step (a full "Clone Season" roster copy, §4.2a) that a
genuinely current-only, league-scoped roster doesn't need at all. **The roster belongs to the
league, not to a year of it.**

This is still a **sport/tour roster**, not a flat golfer list: a PGA Tour event's field is
drawn from PGA Tour members, an LPGA Tour event's field from LPGA members, a Champions Tour
(Senior) event from its own membership, a LIV event from LIV's — different, non-overlapping
player pools that happen to all be "golfers" (`Sport = GOLF`). That separation falls directly
out of the schema below: `ParticipantLeagueAffiliation` is scoped to one `SportLeague` (design
note below on why `SportLeague` is a real table, not an enum — this request is the proof:
"Champions Tour" is just another row, no migration). A PGA Tour golfer and an LPGA Tour golfer
never share a roster even though both roll up to the one `GOLF` `Sport` row.

**The roster is the default seed source, not a membership constraint.** Real golf tournaments
sometimes invite players from outside their own tour — a PGA event granting a sponsor
exemption to a LIV golfer, for instance — and inconsistently, not by a rule the schema could
encode. `SportEventParticipant` (the tournament field, pre-existing) has **no foreign key to
`ParticipantLeagueAffiliation`** — it FKs directly to `Participant` (the global golfer identity)
and `SportEvent`. Seeding (§4.7) *copies* the tournament's league's currently-active affiliated
participants into `SportEventParticipant` as a one-time convenience for the common case; it
does not constrain the field to affiliated golfers afterward. Adding golfers to the field
(`adminBulkAddGolfFieldEntries`, §5.2) can browse any league's affiliated roster or search every
golfer in `Participant`, not just the tournament's own league — that's the mechanism for the
exception case, and it needs no special override or referential bypass because there was never
a constraint to bypass. §5.2 and §6.3 cover how the UI surfaces this distinction so an
out-of-roster invite is visible, not just silently possible.

`Season` already exists in the schema (`sportId`, `name`, `year`, `startDate`, `endDate`) but
has **zero backend implementation** — no service, no routes, no repository, nothing reads or
writes it. It is exactly this concept, sitting unused. This plan activates it — purely as a
tournament-calendar grouping now, not a roster boundary — and adds the league + affiliation
tables:

```prisma
/// A real-world sport league/tour/conference — PGA Tour, LIV Golf, LPGA Tour,
/// DP World Tour for golf; NBA, NCAA Basketball, G League for basketball;
/// NFL, NCAA Football, CFL, XFL for football. Cross-sport by design (`sportId`
/// scopes it), not golf-specific — see the design note below. Named
/// `SportLeague`, not `League`, because `League` is already taken by the
/// PoolMaster office-pool model (`model League` — the entity a commissioner
/// runs); reusing the name would collide both at the schema level (Prisma
/// requires unique model names) and in the product's everyday vocabulary.
/// The naming pattern mirrors `SportEvent` disambiguating from the
/// event-bus "event" elsewhere in this schema.
model SportLeague {
  id              String   @id @default(uuid()) @db.Uuid
  sportId         String   @map("sport_id") @db.Uuid
  name            String                                    // "PGA Tour", "LIV Golf", "LPGA Tour"
  matchKeyword    String?  @map("match_keyword")             // plain catalog-browse filter, §4.4a — e.g. "PGA", "LIV"
  currentSeasonId String?  @map("current_season_id") @db.Uuid // see "current season" note below
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz

  sport         Sport     @relation(fields: [sportId], references: [id])
  currentSeason Season?   @relation("CurrentSeason", fields: [currentSeasonId], references: [id])
  seasons       Season[]  @relation("LeagueSeasons")
  affiliations  ParticipantLeagueAffiliation[]

  @@unique([sportId, name])
  @@map("sport_leagues")
}

model Season {
  // ...existing columns unchanged, EXCEPT sportId — see design note below...
  isActive      Boolean @default(true) @map("is_active")       // soft-lifecycle, a season can be retired
  sportLeagueId String  @map("sport_league_id") @db.Uuid       // NOT NULL — replaces sportId (below)

  sportLeague      SportLeague  @relation("LeagueSeasons", fields: [sportLeagueId], references: [id])
  currentForLeague SportLeague? @relation("CurrentSeason")   // back-relation, unused directly
  sportEvents      SportEvent[]                               // §4.3 — the tournament calendar for this year

  @@unique([sportLeagueId, year])   // one "PGA Tour 2026" per league, not two by accident
}
```

`Season.sportId` is **dropped**, not left alongside `sportLeagueId`. `Season` has zero
existing rows and zero existing callers (§4.2's opening paragraph), so this is a genuine
redesign of a dormant column, not a breaking change — there is no data to migrate and nothing
reads `Season.sportId` today. A season's sport is now derivable exactly one way:
`Season.sportLeagueId → SportLeague.sportId → Sport`. There is no second, independently-settable
path for a `Season` to disagree with its own league about which sport it belongs to, because
there is no second path at all. `Season` no longer owns a roster relation at all — it is purely
"this league's tournament calendar for this year" (§4.3).

```prisma
/// Which golfers/teams are currently affiliated with which league, plus their
/// current world ranking. Not season-scoped — a golfer's tour membership and
/// ranking don't reset every year, and this plan has no requirement to answer
/// "what was it as of a past season." Current value only, admin/sync-maintained,
/// the same way a round's score is maintained: the latest write wins, no history.
/// worldRanking lives here, not on Participant, because it's a fact about a
/// specific ranking system, not about the person — PGA Tour (OWGR), LPGA
/// (Rolex Rankings), and Champions Tour each maintain their own separate,
/// non-comparable ranking, so "the #7 PGA golfer" and "the #7 LPGA golfer"
/// aren't two numbers on one list, they're numbers from two different lists.
/// A golfer affiliated with two leagues at once (e.g. a senior PGA Tour player
/// who also plays Champions Tour events) needs two independent numbers, which
/// a single field on Participant couldn't hold.
model ParticipantLeagueAffiliation {
  id            String   @id @default(uuid()) @db.Uuid
  participantId String   @map("participant_id") @db.Uuid
  sportLeagueId String   @map("sport_league_id") @db.Uuid
  worldRanking  Int?     @map("world_ranking")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  participant Participant @relation(fields: [participantId], references: [id])
  sportLeague SportLeague @relation(fields: [sportLeagueId], references: [id])

  @@unique([participantId, sportLeagueId])
  @@index([sportLeagueId, worldRanking])
  @@map("participant_league_affiliations")
}
```

`Participant.status` (`ACTIVE`/`INACTIVE`, **pre-existing column**, already written by
ingestion today) is what hides a retired golfer — no new boolean needed. A golfer's
affiliation row itself is deleted (not soft-flagged) when they leave a tour entirely, e.g. a
LIV golfer returning to the PGA Tour once LIV's own wind-down completes; retiring outright is a
`Participant.status = INACTIVE` edit, not an affiliation change, since retirement isn't
league-specific. `worldRanking` here is maintained the same way round scores are: a bulk
paste/upload/preview/apply flow (§5.2, §6.3) plus per-row manual edit, always current, never
derived data invented by the app, and — the trade-off made explicit — never historically
snapshotted. That's a fine concession: this model never actually protected mid-season ranking
history either (every update already overwrote the single value it held), so nothing that used
to work stops working.

**"Current season" is an admin-designated pointer, not computed — and its job is narrower
than an earlier draft of this plan assumed.** `SportLeague.currentSeasonId` names which one of
its seasons is current right now — set by an admin action (§5.2, §6.3), never inferred from
dates. Seasons can be pre-created years ahead (a 2028 PGA Tour row, a 2029 NFL season row are
perfectly fine to have sitting in the table already), and promoting the next one to current is
a single admin action taken once, around when the real-world season turns over — not an
automated boundary calculation. Its actual job is to default the Create Tournament form's
Season picker (§6.3) to the right season so the admin isn't re-selecting it every time —
nothing more, and it has nothing to do with the roster at all now that the roster isn't
season-scoped. It is **not** an automatic resolver for incoming provider payloads, because
PoolMaster events are never auto-created from a provider feed at all under this plan's
confirmed direction (§4.9): every event is admin-authored, with its season — and therefore its
league and sport — fixed at creation, before any provider link exists. Linking (§4.4) only
ever attaches a `providerId`/`externalId` to an already-fully-specified event, purely so the
score-polling loop has something to match against; which league the event belongs to was never
in question at link time. §4.9 explains why this replaces, rather than merely simplifies, the
per-league boundary-detection problem this note originally described.

**Design note — why `SportLeague` is a real, cross-sport table, not an enum and not a
`Sport` value.** This model went through two revisions before landing here, worth recording
because the reasoning carries the decision:

1. *First draft:* a `Season.league` enum (`PGA_TOUR | LIV_GOLF | LPGA_TOUR | …`), golf-scoped.
   Wrong for the same reason `Sport` itself is a table and not a hardcoded list: adding
   "Champions Tour" or "Korn Ferry Tour" later should be an admin inserting a row (§5.2, §6.3),
   not a Prisma migration.
2. *Second draft:* `GolfTour`, a real table but named and scoped as golf-only, matching the
   per-category convention this plan otherwise follows (`SportEventGolfTier`, etc.). Too
   narrow — basketball has NBA/NCAA Basketball/G League, football has NFL/NCAA Football/CFL/
   XFL; every sport with more than one governing body needs the identical shape. Building it
   golf-only would mean rebuilding the same table under a different name for every future
   sport.
3. **This draft:** `SportLeague`, sport-scoped via `sportId` (not golf-scoped by name), so
   `Sport → SportLeague → ParticipantLeagueAffiliation` (the roster) and
   `Sport → SportLeague → Season → SportEvent` (§4.3, the tournament calendar) are the *same
   two chains* for golf, basketball, football, or any future sport — only the row data differs
   (`SportLeague` rows for golf: "PGA Tour" / "LIV Golf" / "LPGA Tour" / "Champions Tour"; for
   basketball: "NBA" / "NCAA Basketball" / "G League"; for football: "NFL" / "NCAA Football" /
   "CFL" / "XFL"). The shared table lives behind a shared service, not `modules/golf/` — see
   §3.2.

Today "league" isn't modeled at all in the platform: the flat `Sport` enum
(`packages/shared/domain/enums.ts` — `GOLF`, `NFL`, `NBA`, `NCAA_BASKETBALL`,
`NCAA_FOOTBALL`, …) is the *only* separation mechanism that exists, and it conflates sport
and league by brute force — NFL vs. NCAA football are two independent top-level enum values,
each with its own registered *data provider* (`provider-registry.ts:getProvider(sport)` keys
on this same enum). `SportLeague` does not replace that mechanism or touch the provider
registry — it solves a different problem ("which real-world organization is this season/event
part of," a display/matching/roster-scoping concern), not "which adapter serves this sport's
data" (a sync-integration concern). The two can diverge (NFL/NCAA football already get separate
providers *because* they're separate top-level `Sport` values; a future LIV-specific provider
would need the same treatment, `SportLeague` alone doesn't provide it — flagged in §9). Until
then, one `Sport` row can safely contain several `SportLeague` rows served by the same data
provider, matching golf's current reality (one provider, several tours).

`SportLeague` also solves roster separation for free, now at the league level rather than the
season level: since `ParticipantLeagueAffiliation` is scoped to one `SportLeague`, PGA Tour
golfers and LPGA Tour golfers never share a roster even though both sit under the one `GOLF`
`Sport` row — the same holds for NBA and NCAA Basketball teams under `Sport = BASKETBALL`, once
a basketball admin plan builds on this same substrate. This plan still ships **only the golf
admin surface** (`/sports/golf/leagues`, `/sports/golf/seasons`, …, §5.2) — see §10 for what
that does and doesn't imply for other sports.

### 4.2a Cloning a season's tournament calendar for the next year

Most of a season's tournament calendar repeats year to year — nearly the same events on
nearly the same dates. **Clone Season** turns "set up 2027's calendar" into "copy 2026's
tournaments forward and confirm dates" instead of rebuilding it from nothing. This is now
purely a tournament-calendar convenience — §4.2's roster restructuring means there is no
roster left to clone: the same league-wide, always-current roster
(`ParticipantLeagueAffiliation` + `Participant.status`) already applies to 2026's and 2027's
tournaments identically, with no copy step at all. A golfer added or retired once is available
(or excluded) for every tournament going forward, this year's or next's.

**`adminCloneGolfSeason`** (`POST /sports/golf/seasons/:seasonId/clone`, body
`{ targetYear? }`, defaulting to `sourceYear + 1`) does one thing: `season-service.
cloneSeasonTournaments(seasonId, targetYear)` (cross-sport, §3.2) creates the new `Season` row
(`sportLeagueId` unchanged, `year` = `targetYear`, `startDate`/`endDate` shifted forward exactly
one calendar year — same month/day, year + 1, not a naive `+365` days, so it lands correctly
across a leap year), then **re-runs creation, rather than deep-copying the row**, for each
source-season tournament. Copying a `SportEvent` row directly would be wrong, not just
redundant — last year's field, tiers, prices, round scores, and provider link are specific to
*that instance* of the tournament, not the tournament as a recurring calendar entry, and
dragging them into the new year would leave 2027's "Masters" pre-populated with 2026's field
and a stale provider link before anyone set it up. So cloning an event means **calling the same
internal creation function `adminCreateGolfTournament` already uses** (§5.2), once per
source-season tournament, with `name`/`venue`/`location`/`rounds`/`parForRound`/
`autoLifecycleEnabled` copied as-is and `startDate`/`endDate`/`releaseAt`/`fieldLocksAt` shifted
forward one calendar year (same rule as the season's own dates), targeting the new season.
Every default the real creation path already gets — empty field, `ensureSportEventRounds`'s
fresh `SportEventRound` schedule, `ensureDefaultGolfTiers`'s 6 default tier rows (§4.5a),
`syncScope = NONE` / `manual-admin` placeholder identity — comes along for free, because it's
the identical code path, not a parallel one that would need its own logic to decide what *not*
to copy. Nothing about a provider link, field, tier assignment, or score carries forward, by
construction, not by a special case that excludes them.

**Does not auto-promote the new season to current.** `SportLeague.currentSeasonId` stays on the
source season until the admin explicitly runs **Set as current season** (§4.2, §5.2) once the
new season's tournament dates have actually been reviewed — cloning prepares next year, it
doesn't switch to it.

Response: `{ season, tournamentsCloned }` — enough for the confirmation UI (§6.3) to show a
real count before the admin commits, the same pattern as every other bulk action in this plan
(seed field, bulk upload preview).

### 4.3 Tournament ↔ season link

`SportEvent` gains one additive, **required** column:

```prisma
seasonId String @map("season_id") @db.Uuid
season   Season @relation(fields: [seasonId], references: [id])
```

**`NOT NULL`, not nullable-with-an-application-boundary-workaround.** An earlier draft of this
section kept the column nullable, reasoning that it's shared and platform-wide while other
sports' ingestion-created rows have no season link. That reasoning is now obsolete, not just
golf-specific: `plans/125` deletes `EVENTSCHEDULE` and its `persistEventsWithDiagnostics` call
entirely (§3.1) — verified via grep that `ingestion-persistence.ts:135`'s upsert inside that
function is the **only** `SportEvent`-creating call site anywhere in `packages/core-api/src`.
Once it's gone, `adminCreateGolfTournament` and `adminCreateGolfTournamentFromProviderEvent`
(§4.4a) are the only two places a `SportEvent` row can ever be created, for any sport, and both
already require `seasonId`. `EVENTPARTICIPANTS`/`EVENTLIVESCORES` only ever update an
already-existing row (matched by `providerId`/`externalId` or by round/participant identity) —
neither can create one. There is no remaining code path, present or future-shaped, that
constructs a `SportEvent` without a season, so there is nothing left for a nullable column to
protect against. `seasonId` is immutable after creation (not part of the update body) — a
tournament's season is structural context, not something you edit later, the same way
`Season.sportLeagueId` is immutable (§4.2). This is the source `POST .../field/seed` reads from
(§4.7, §5.2). (Existing test fixtures/factories that construct a `SportEvent` directly, if any,
need a sweep to pass `seasonId` — the same kind of test-inventory check `plans/125` §7 already
flags for its own deletions, not a design concern.)

**`SportEvent.sport` is a separate question, deliberately not resolved here.** It's a
pre-existing bare `String` (not FK'd to `Sport`), used purely for provider routing
(`scheduled-event-reader.ts`, `provider-registry.getProvider(sport)`, every adapter). Making
`seasonId` required doesn't retire `sport` — routing needs a sport key on the row regardless of
whether a season chain also resolves to one, and unifying the two would be a larger,
cross-cutting change to every routing call site, not a natural consequence of this one column's
nullability. Worth an explicit follow-up question if you want it pursued; out of scope for this
plan otherwise.

Given `sport` has to stay, is there still a "these two could disagree" risk? No — because
`sport` is never independently admin-settable in this flow to begin with.
`adminCreateGolfTournament`/`adminUpdateGolfTournament` (§5.2) hardcode `sport = 'GOLF'`
unconditionally for any row created through `/sports/golf/tournaments`; the client never
supplies it. The only place a client-supplied value enters is `seasonId`, and that's ordinary
foreign-key-target validation — the same kind every route already does when accepting an id
that must resolve to a specific type (e.g. `ContestManagementService` validating a
`sportEventId` resolves to a real event before creating a contest against it). The shared
`season-service.ts` (§3.2) rejects a `seasonId` that doesn't resolve to a `GOLF`-scoped season
with `422 SEASON_SPORT_MISMATCH`, the same way it would reject any id that doesn't resolve to
the expected kind of row — not because two independently-true facts might drift, but because
one caller-supplied reference has to be checked against the type it's supposed to point to.
A future basketball admin plan gets the identical check for free, hardcoding `sport =
'BASKETBALL'` in its own routes and passing that expectation into the same shared validation.

### 4.3a Recurring tournament identity — `LeagueEvent`, separate from any one year's `SportEvent`

Added while designing `plans/127`'s category-draft history needs, but it belongs here: it's
cross-cutting tournament-calendar infrastructure this plan's own Clone Season (§4.2a) directly
benefits from, not a `plans/127`-specific concept. The Masters is the Masters every year; the
US Open is always the US Open — a stable identity distinct from "The Masters 2026" (one year's
`SportEvent` row). No such identity currently exists anywhere in the schema, which is exactly
why `plans/127`'s previous-winners history had nowhere clean to link.

```prisma
/// A recurring, named tournament that repeats year after year under one
/// stable identity — "The Masters," "The US Open" — separate from any one
/// year's SportEvent instance of it. SportEvent rows point here; this never
/// points to a specific year.
model LeagueEvent {
  id            String   @id @default(uuid()) @db.Uuid
  sportLeagueId String   @map("sport_league_id") @db.Uuid
  name          String
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  sportLeague SportLeague  @relation(fields: [sportLeagueId], references: [id])
  sportEvents SportEvent[]

  @@unique([sportLeagueId, name])
  @@map("league_events")
}

// SportEvent: one additive, nullable column
leagueEventId String? @map("league_event_id") @db.Uuid
leagueEvent   LeagueEvent? @relation(fields: [leagueEventId], references: [id])
```

**Nullable and auto-resolved, not a new admin decision.** `leagueEventId` is nullable because
not every tournament is a recurring one (a one-off exhibition doesn't need a stable identity),
and resolving it needs **zero new UI**: both `adminCreateGolfTournament` and
`adminCreateGolfTournamentFromProviderEvent` (§4.4a) find-or-create a `LeagueEvent` by
`(sportLeagueId, name)` — matching by the tournament's own name within its league, the same
find-or-upsert-by-name pattern already used elsewhere in this schema (e.g. `Sport` rows).
Creating "The Masters" in the PGA Tour league the first time creates a new `LeagueEvent`
row; creating it again next year (whether by hand or via Clone Season) resolves to the *same*
row automatically. **Clone Season (§4.2a) needs no special-casing for this at all** — it
already calls the identical `adminCreateGolfTournament` internal function per source-season
tournament, so the new year's tournament resolves to the same `LeagueEvent` as the source by
construction, for free.

This is what makes `plans/127`'s previous-winners table clean: it links to `LeagueEvent`, not
to any one year's `SportEvent`, so there's nothing to "copy forward" between years at all — the
history is already attached to the one stable row every year's tournament shares.

### 4.4 Sync scope & score-source linking

The schema mechanics behind §3.5. One new enum, one new column, both on `SportEvent`:

```prisma
enum PrismaSportEventSyncScope {
  NONE          // no sync feed may touch this event (manual/QA default)
  SCORES_ONLY   // only EVENTLIVESCORES + EVENTRESULTS may sync; schedule/field/rankings never can
  FULL          // every feed may sync (default for ingestion-created rows; today's behavior)
}

// SportEvent:
syncScope PrismaSportEventSyncScope @default(FULL) @map("sync_scope")
```

`@default(FULL)` matters: it means any `SportEvent` row the ingestion pipeline creates today,
unmodified by this plan, keeps behaving exactly as it does now. Only rows created through the
new `POST /sports/golf/tournaments` route start at `NONE` — the default never silently
changes behavior for an existing code path.

**`scheduled-event-reader.ts`** (`toFeedWhere`) gains one clause per feed:

```ts
// EVENTSCHEDULE / EVENTPARTICIPANTS / PARTICIPANTRANKINGS:
{ ...existingWhere, syncScope: 'FULL' }

// EVENTLIVESCORES / EVENTRESULTS:
{ ...existingWhere, syncScope: { in: ['FULL', 'SCORES_ONLY'] } }
```

Manual sync triggers (`adminSyncProviderEventData`) get the same guard so a one-off admin
sync action can't bypass the scope either.

**Linking** (`event-score-source-service.ts`, §3.4 — cross-sport, called by golf's admin
routes, not owned by them): an admin action that reads
`providerRegistry.getProvider(sport).getUpcomingEvents(sport, dateRange)` live (no dependency
on `SportEvent` rows or the schedule feed having ever run), lets the admin pick one, and in a
single transaction:

1. Rejects with `409 EXTERNAL_EVENT_ALREADY_LINKED` if another `SportEvent` row already holds
   that `(providerId, externalId)` pair (see open questions, §9).
2. Updates `providerId`, `externalId`, and `syncScope = 'SCORES_ONLY'` on the tournament.
3. Does **not**, by itself, import the provider's field or odds — a tournament that already has
   an admin/season-authored field (§4.2) keeps it untouched. Importing from the now-linked
   provider is a separate, explicit action the admin can take afterward — the same **Refresh
   field** action §4.4a describes for the browse-and-create flow, available here too once
   linking sets `syncScope != 'NONE'`.

**No auto-match — present the list, admin picks. Deliberately simple, not a placeholder for a
smarter version later.** An earlier draft of this plan scored candidates by name/location/tour-keyword
similarity and surfaced a single auto-suggested match when confident enough
(`event-score-source-service.findCandidateMatches`). The user cut it directly, and the
reasoning holds up: it was pure UX convenience layered on top of a fully-functional manual
picker that already solves the whole problem by itself, it required tunable weights and a
"clears the threshold" cutoff that were never validated against real data, and its main use
case — retroactively linking a manually-typed tournament — is shrinking anyway now that §4.4a's
browse-and-create flow links a tournament to its provider event at creation time, with no
matching needed at all. Unlike the odds/seed derivation (§4.7), which produces data every field
participant genuinely needs with no simpler fallback, this had a working fallback the whole
time.

**What linking actually does now**: calls `getUpcomingEvents('GOLF', { from: tournament.startDate
- 3d, to: (tournament.endDate ?? tournament.startDate) + 3d })` — the same narrow date window,
kept because it's still a reasonable server-side filter, not because any scoring runs on the
result — and shows the returned list, admin selects one. No "suggested match," no ranking, no
scoring weights to tune. `event-score-source-service.ts` (§3.4) still exists as the shared home
for this cross-sport lookup, it just doesn't score anything anymore — `findCandidateMatches` is
deleted, not replaced.

**Unlinking** reverses all three fields back to the `manual-admin` placeholder identity and
`syncScope = 'NONE'`; already-synced score rows are left in place (no data loss), the
tournament simply stops receiving further automatic score updates.

### 4.4a Creating a tournament directly from a browsed provider event, and loading its field

§4.3/§5.2 describes building a tournament by hand, then §4.4 above describes separately
linking it to a provider event for scores. This section adds a second, equally first-class
entry point — reachable from a chosen league's season, matching the actual admin path
(League → its current season → new tournament, not a flat unscoped form) — plus the on-demand
field-load action every linked tournament shares afterward, regardless of how it was created.
**These are two separate, explicitly admin-triggered steps, not one bundled action**: creating
the tournament never auto-imports its field; loading the field is always its own click.

**Step 1 — create, scoped to a league.** Season Home (`/manage/golf/seasons/:seasonId`, §6.3)
gains a **New tournament** header action, navigating to
`/manage/golf/tournaments/new?seasonId=<id>`. The Create page's Season `Select` arrives
pre-filled from that context (still changeable) — this is "Golf → select league → its season →
create new event," not a global form the admin has to independently point at the right league
each time. Arriving with a season pre-selected also scopes the **"Browse provider events"**
mode (§6.3's existing segmented header) to that season's `sportLeague`: extend
`adminListProviderCatalogEvents`'s query with an optional `sportLeagueId` and a `from`/`to`
date range. `sportLeagueId` resolves server-side to that league's `matchKeyword` and applies a
**plain substring filter** — does the candidate's name contain the keyword (e.g. "PGA")? — not
a scored/penalized ranking (§4.4 deletes that algorithm entirely, and this browse filter never
had its own separate one to begin with). A league with no `matchKeyword` set contributes no
filter at all, showing the unfiltered catalog for that browse. Browsing without a league
context (the flat `/manage/golf/tournaments/new` entry, still reachable from the Tournament
list) simply omits `sportLeagueId` and shows the unfiltered catalog, as today.

**The mock provider is not a schema authority.** Its shape reflects a made-up test utility,
built specifically so PoolMaster's code isn't coupled to any one real vendor's contract — it
must not be read as "what real provider payloads look like." Every derivation this plan writes
against provider data follows two rules instead: (1) never assume a real provider's payload
is as sparse as the mock's, (2) always defensively check for a richer field before falling back
to a PoolMaster-computed default — so a future real adapter that *does* supply something the
mock doesn't (a `rounds`/schedule breakdown, e.g.) is honored automatically, with zero changes
to the derivation call site.

**`adminCreateGolfTournamentFromProviderEvent`** — body `{ seasonId, providerId, externalId }`.
On selecting a browsed event and committing:

1. Calls `event-score-source-service.getProviderEventDetail(sport, externalId)` (§3.4 — the
   same registry resolution `adminListProviderCatalogEvents` already uses, not a
   direct `providerRegistry` call from this module) for name, venue, and overall
   `startDate`/`endDate`, then derives the tournament's round schedule via a new pure function,
   `golf-seeding-algorithm.deriveGolfTournamentRounds(startDate, endDate, providerRounds?)`:
   - **Defensive first check: an explicit provider-supplied round schedule.** If the provider
     response carries its own round-by-round breakdown, use those dates directly, one
     `SportEventRound` per entry — no PoolMaster-side derivation needed when the source already
     has the real answer. The mock provider's contract has no such field today (verified —
     `EventScheduleRecord` exposes only `startsAt`/`endsAt`/`releaseAt`/`fieldLocksAt`, no
     round-count and no per-round dates), so this branch is dead code against the mock
     specifically, by design — it exists for whichever real adapter is built next, per the two
     rules above, not for anything the mock will ever exercise.
   - **Default, since the mock (and possibly a real provider) has nothing richer**: assume 4
     rounds — Round 1 on `startDate`, Round 2 the next day, Round 3 the day after that, and
     **Round 4 on `endDate` when the provider supplies one** (falling back to `startDate + 3`
     days only when `endDate` is absent too) — rather than blindly assuming a fixed 3-day span
     and hoping it happens to land on the provider's own reported end date.
   - `rounds` (the count) is a byproduct of this derivation, not a separately admin-typed field
     the way manual creation (§5.2) still works — the admin can still edit any individual
     round's date afterward via `adminUpdateGolfTournamentRounds` (§5.2, §6.3), same as any
     other tournament.
2. Creates the `SportEvent` with `providerId`/`externalId` set directly and
   `syncScope = 'SCORES_ONLY'` immediately — skipping the `manual-admin` placeholder identity
   and the separate §4.4 link step entirely, since the provider identity is already known.
   `seasonId` is still required (§4.3's rule is unconditional).
3. Persists the derived round schedule from step 1. `ensureSportEventRounds` (§4.10) narrows
   to exactly this role — given a concrete list of `{ roundNumber, scheduledDate }` — for both
   callers: manual creation computes its list trivially (sequential daily from an admin-typed
   `rounds` count, unchanged), this flow computes its list via the richer derivation above.
4. **Does not touch the field.** Navigates to Tournament Home with field count at zero — Step 2
   is a distinct, visible action from there, not silent follow-on work inside step 1's request.

**Step 2 — load (then refresh) the field, as a real, ledger-tracked manual sync — not a
bespoke admin write path.** `packages/core-api/src/modules/admin/provider-service.ts` already
has a complete, working mechanism for exactly this shape of action:
`providerService.syncEventData({ sport, eventId, feeds }, rootAdminUserId, rootAdminEmail)`
(verified, `provider-service.ts:842`) validates the provider, submits a
`ProviderSyncRun` row via `syncRunLedger.createSubmissions({ ..., runType: 'MANUAL_EVENT_SYNC' })`
— the exact ledger entry the sync-run-history admin UI already renders, with actor
attribution already built in — then executes the requested feed(s) asynchronously and attaches
each job's `SyncWriteDiagnostics` to its `ProviderSyncRun` on completion. This is precisely the
"plumbing and audit UI we already have" the user asked to keep using, not a parallel mechanism
this plan would otherwise be inventing. **So `adminRefreshGolfTournamentField` does not call a
new golf-specific persistence function directly — it's a thin, golf-scoped wrapper**: resolve
the tournament's `sport`/`externalId` from its `eventId`, then call
`providerService.syncEventData({ sport: 'GOLF', eventId: externalId, feeds: ['EVENTPARTICIPANTS'] },
actor.userId, actor.email)` and return its `syncRuns`. `409 EVENT_NOT_LINKED` when
`syncScope === 'NONE'` reuses whatever gate `plans/125` slice 2 adds to `syncEventData` itself
for this exact case (§3.2) — no separate gate to keep in sync.

**Consequence for the UI**: this is the same asynchronous submit-then-poll shape the generic
`run-event-sync-page.tsx` already has to handle (`syncEventData` returns immediately; the job
runs via `setImmediate` and completes later) — the Field editor's **Load**/**Refresh
Participant Field** button submits, shows a syncing state, and polls/invalidates
`adminGetGolfTournamentField` once the returned `syncRuns` complete, rather than treating the
response as the finished result.

**The underlying feed logic is `IngestionScheduler.runEventFieldSync`
(`ingestion-scheduler.ts:776`, the existing `EVENTPARTICIPANTS` job) — unchanged in identity,
fixed in what it persists.** Both this button and the pre-existing generic sync-lane trigger
now go through the identical execution path, so the status-overwrite bug flagged earlier
(§4.10) is fixed exactly once, at the source, for both callers: `runEventFieldSync` swaps its
call from `persistEventDetailWithDiagnostics` (event upsert + status write + contest
side-effects) to a new, narrower **`golf-field-service.seedFieldFromProvider(eventId)`** —
extracted from `IngestionPersistence`'s existing `persistParticipantsWithDiagnostics` behavior
(`ingestion-persistence.ts:~480-535` — look up `ParticipantProviderMapping` by the exact
`(providerId, externalId)` key; found → update the existing `Participant`; not found → create
`Participant` + `ParticipantProviderMapping` in one transaction) — field/participant matching
only, no event-row write, no status write, no contest side effects, ever. Per contestant
returned by `provider.getEventDetails`'s field/odds response (`ContestantRecord` — verified
fields: `ranking?`, `odds?`, `seed?`; no `price` field exists anywhere in the provider
contract):

1. Resolve or create the global `Participant` + `ParticipantProviderMapping` by exact provider
   identity (never fuzzy name-matching — this is precisely why the mapping-by-identity approach
   matters: it's what lets `EVENTLIVESCORES`' later score matching by `externalId` work at all
   for a field populated this way).
2. Upsert a `SportEventParticipant` row, writing `worldRanking`/`oddsToWin` from the provider's
   values where present. **Neither field is guaranteed present, and they can be present
   independently** (verified against the contract — `ranking` and `odds` are two unrelated
   optional fields, not a pair that's always both-or-neither) — §4.7's derivation generalizes
   from "used only when a golfer has neither value" to a per-golfer priority chain:
   - **Both present** — use as-is, no derivation.
   - **`ranking` present, `odds` missing** — derive `oddsToWin` from `ranking`-based position
     via §4.7 step 3's existing weight/jitter formula, unchanged.
   - **`odds` present, `ranking` missing** — derive an implied position by sorting this
     field's known-`odds` golfers ascending (shortest odds first) and assigning position
     ordinally, the same tie-break shape as §4.7 step 2, inverted; that position feeds
     `seedNumber` the same way §4.7 already does.
   - **Neither present** — fall back to `ParticipantLeagueAffiliation.worldRanking` for this
     golfer if they're affiliated with the tournament's league (treat as the "`ranking` present"
     case above); otherwise no
     signal exists, and they fall to the bottom of the tie-break pool exactly as §4.7 already
     handles a season-only golfer with no recorded world ranking.
   `seedNumber` always runs through this same position assignment regardless of source, since
   seed position is PoolMaster's own draft concept, not something to expect a scoring provider
   to supply. **`price` is never provider-sourced under any branch** — confirmed absent from
   the contract entirely — so it has no "if null" case here; `adminAutoAssignGolfPrices` (§4.7a)
   remains the only path to it, unchanged, run whenever the admin chooses to, same as today.
3. This step is an **upsert, not a create-only seed**: running it twice for the same tournament
   updates existing rows rather than duplicating them, matched by the same
   `ParticipantProviderMapping` identity — which is exactly what makes one button correctly
   serve both "Load" (first click, empty field) and "Refresh" (later clicks, non-empty field)
   without being two different operations underneath.

This is what makes provider field data an on-demand pull rather than a recurring sync:
`plans/125` §3.1/§3.2 already deletes `EVENTSCHEDULE` and defaults `EVENTPARTICIPANTS` off —
this button is the discoverable, tournament-scoped front door onto the same
`syncEventData`/`runEventFieldSync`/`seedFieldFromProvider` chain the generic
`adminSyncProviderEventData`/`EVENTPARTICIPANTS` sync-lane page also submits to — one
mechanism, one ledger, two entry points into it (§3's architecture: admin routes separate from
sync routes, converging on shared business logic — this is that principle one layer deeper than
usual, converging all the way down to the sync-run ledger itself, not just a service function).
Refresh (not first Load, since there's nothing to overwrite yet) shows a `ConfirmationModal`
warning that it can overwrite manually-adjusted rank/odds values for any golfer the provider
still reports, the same overwrite caveat the Round scores page already states for live score
corrections (§6.3). Once the field is loaded, the admin browses it in the Field editor, manually
adjusts price/odds inline, and drag-and-drops tier assignments in the Tier editor (§6.3) exactly
as with any other field-population source — tier/price derivation (§4.6/§4.7a) is agnostic to
whether `worldRanking`/`oddsToWin` came from a provider or the season-roster algorithm.

**Removing a player from the master roster is a status change, not a delete.** `Participant`
already carries `status: ACTIVE | INACTIVE` (written this exact way by
`persistParticipantsWithDiagnostics` today). No `DELETE /sports/golf/players/:participantId`
route exists or is planned — "removing" a golfer from the master roster is
`adminUpdateGolfPlayer({ status: 'INACTIVE' })`, never a hard delete: the roster is referenced
by potentially years of historical `SportEventParticipant`/`ContestEntryPick` rows across past
tournaments, and hard-deleting would either cascade-destroy that history or require the same
kind of defensive nullable-FK handling this whole plan has been removing elsewhere. `adminListGolfPlayers`
and the **Add golfer** picker (§6.3) default to `status = ACTIVE`; the Player list page's
existing **Status** column (§6.3) is exactly where an admin sees and changes this.

### 4.5 Event-level tiers and price — one valuation record per field participant

Tiers and price are the same underlying concept — a per-golfer draft valuation — expressed
two ways for two draft formats (pick-a-tier vs. spend-a-budget). They're merged into one
table for exactly that reason, and both are **event-level only**: no contest may define its
own tiers or its own per-player prices (§4.6 explains why that's safe to drop, not just
simplify).

Before this plan, tiers were three inconsistent things: `ContestConfiguration.tierConfig`
(legacy JSON), `ContestConfiguration.configJson.tiers` (typed, per-contest), and
`SportEventParticipantValuation.tier` (a free-text `String`, written only on contest-config
save — the reason re-syncing a field after config save silently desynchronized tier
ordering). Price was, separately, a fourth thing that never actually worked:
`SportEventParticipantValuation.price` has exactly one writer
(`derivePersistedTierConfig`), and that writer always sets `price: undefined` — confirmed by
reading the code, not assumed. There is no working budget/price feature to preserve.

**A related, fully verified finding: today's `GolfTieredContestConfig.tierGeneration.defaultTierSize`
and `.tierSource` are decorative, not functional.** Both are hardcoded literals
(`tierSource: 'ODDS'`, `tierGeneration: { defaultTierSize: 10 }`) written unconditionally by
`derivePersistedTierConfig`'s response mapper (`contest-management/service.ts:766-769`) —
grepped for every other reference to `defaultTierSize`/`tierGeneration` in `packages/core-api/src`
and found none. Nothing ever reads them to actually generate a tier boundary; `compareTierCandidates`
(the real sorting logic, `service.ts:552`) only ever partitions candidates against
`configuration.tiers`' admin-typed `startPosition`/`endPosition` values — there is no
"auto-generate N tiers of size M" algorithm anywhere in the current codebase, despite the
`defaultTierSize: 10` literal creating the impression one exists. This confirms §4.8's deletion
of `derivePersistedTierConfig` is safe, and explains why §4.5a below is genuinely new logic, not
a port of something that already worked.

```prisma
/// Per-tournament tier definition. Event-level only — no contest override (§4.6).
model SportEventGolfTier {
  id                String   @id @default(uuid()) @db.Uuid
  sportEventId      String   @map("sport_event_id") @db.Uuid
  tierKey           String   @db.VarChar(50)
  label             String   @db.VarChar(100)
  tierNumber        Int      @map("tier_number")
  defaultPickCount  Int      @map("default_pick_count")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz

  sportEvent  SportEvent @relation(fields: [sportEventId], references: [id])
  valuations  SportEventParticipantGolfValuation[]

  @@unique([sportEventId, tierKey])
  @@unique([sportEventId, tierNumber])
  @@map("sport_event_golf_tiers")
}

/// The tier and/or price for one golfer in one tournament — "part of the
/// EventParticipant model" (one row per SportEventParticipant, same 1:1
/// shape as worldRanking/oddsToWin/seedNumber already living there).
/// Replaces both SportEventParticipantGolfTierAssignment (an earlier draft
/// of this plan) and the legacy SportEventParticipantValuation — dropped,
/// but NOT because nothing reads it. An earlier draft of this section
/// claimed that and was wrong: `drafts/routes.ts` reads
/// `SportEventParticipant.valuations[0].tier`/`.price` directly, in
/// multiple places, as the real, live draft room's tier-fallback and only
/// price source (verified by reading the code, not assumed). Dropping this
/// table is still correct — the draft room needs to read the *new* tables
/// regardless — but it is a real, in-scope rewiring of live code, not a
/// zero-risk deletion of something unused. See §4.6b.
model SportEventParticipantGolfValuation {
  id                      String   @id @default(uuid()) @db.Uuid
  sportEventParticipantId String   @unique @map("sport_event_participant_id") @db.Uuid
  sportEventGolfTierId    String?  @map("sport_event_golf_tier_id") @db.Uuid
  tierOrderIndex          Int?     @map("tier_order_index")
  tierAssignedSource      PrismaGolfValuationSource? @map("tier_assigned_source")
  price                   Decimal? @db.Decimal(10, 2)
  priceAssignedSource     PrismaGolfValuationSource? @map("price_assigned_source")
  createdAt               DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime @updatedAt @map("updated_at") @db.Timestamptz

  sportEventParticipant SportEventParticipant @relation(fields: [sportEventParticipantId], references: [id])
  sportEventGolfTier    SportEventGolfTier?   @relation(fields: [sportEventGolfTierId], references: [id])

  @@index([sportEventGolfTierId, tierOrderIndex])
  @@map("sport_event_participant_golf_valuations")
}

enum PrismaGolfValuationSource { AUTO_ODDS AUTO_WORLD_RANK MANUAL }
```

`@unique(sportEventParticipantId)` is what makes drag-and-drop cheap and correct: one golfer
has exactly one tournament valuation row, and a tier drop is a single-row FK + `tierOrderIndex`
update. Tier and price track their `*AssignedSource` independently — an event that only ever
auto-assigns tiers never has to touch price, and an admin can manually override one without
disturbing the other. The FK to `SportEventGolfTier` replaces the old free-text `tier` string,
satisfying the strongly-typed-end-to-end principle without inventing a closed enum for
per-event tier keys.

### 4.5a Default tier structure: 6 tiers, 10 golfers each, last tier absorbs the rest

Two constants in `golf-tier-service.ts`: `DEFAULT_TIER_COUNT = 6`, `DEFAULT_TIER_SIZE = 10`.

**Tier count is however many `SportEventGolfTier` rows exist for the event — not a separate
parameter that could drift from them.** At tournament creation (both `adminCreateGolfTournament`
and `adminCreateGolfTournamentFromProviderEvent`, §4.4a), a new step —
`golf-tier-service.ensureDefaultGolfTiers(sportEventId)` — creates `DEFAULT_TIER_COUNT` (6)
`SportEventGolfTier` rows: `tierNumber` 1–6, `tierKey` `tier-1`…`tier-6`, `label` "Tier 1"…"Tier 6",
`defaultPickCount` 1 (a reasonable single-pick-per-tier starting point, admin-editable).
This is a default, not a requirement, the same framing §4.10 already uses for round schedules:
fully editable afterward via `adminReplaceGolfTournamentTiers` (§5.2) — add, remove, rename, or
resize down to 2 tiers or up to 12, whatever the event needs. Whatever tier count results is
what auto-assign partitions against; there is no independent "number of tiers" setting to keep
in sync with the actual row count.

**`adminAutoAssignGolfTiers`'s partition algorithm** (§5.2's existing `{ source, tierSize? }`
body, `tierSize` defaulting to `DEFAULT_TIER_SIZE` when omitted): sort the field by `source`
(reusing `compareTierCandidates`'s existing ODDS/WORLD_RANK comparator logic, ported as-is) to
get position 1..N, then walk the event's `SportEventGolfTier` rows in `tierNumber` order,
assigning exactly `tierSize` golfers to each tier **except the last** (highest `tierNumber`),
which absorbs every remaining golfer regardless of count — whether that's 30 golfers in an
80-player field with the 6/10 default, or a handful in a small field, or zero if the field is
smaller than `(tierCount - 1) * tierSize`. This holds for any tier count, not just the default
6: 2 tiers with `tierSize=20` fills tier 1 with the top 20 and dumps everyone else in tier 2,
same rule. Writes `SportEventParticipantGolfValuation.sportEventGolfTierId`/`tierOrderIndex`/
`tierAssignedSource` — no `startPosition`/`endPosition` columns to maintain on the tier
definition itself (unlike the legacy `GolfContestTierDefinition` shape), since the partition is
recomputed fresh from current tier-row count + `tierSize` each time auto-assign runs, not
persisted as a range.

### 4.6 Why tiers and price are event-level only — no contest override

An earlier draft of this plan added `ContestConfiguration.tierMode: INHERIT_EVENT | CUSTOM`,
letting a contest define its own tiers instead of the event's. Dropped: a tier breakdown is a
property of the tournament field itself (derived from odds/rank), not something two different
office pools running on the same tournament have a real reason to disagree about, and
`CUSTOM` was the only thing keeping `ContestConfiguration`'s legacy `tierConfig` /
`configJson.tiers` fields alive. With `tierMode` gone, `GolfTieredContestConfig.tiers` is
never populated by a contest — `golf-tier-service.getEffectiveTiersForContest(contestId)` has
exactly one path: resolve the contest's linked `SportEvent`, read its `SportEventGolfTier` +
`SportEventParticipantGolfValuation` rows, done. `ContestManagementService.derivePersistedTierConfig`
is deleted, as already planned; its callers (`createContest`, `updateContestConfiguration`)
route through the service instead. The same reasoning applies to price once a real
budget-format contest type exists: it reads the event's `SportEventParticipantGolfValuation.price`,
never a per-contest price list.

`assertTierConfigurationFitsSportEvent` / `assertTierConfigurationFitsParticipantCount`
(`contest-management/service.ts:365,409`) stay, simplified: they validate that the *event's*
tier breakdown satisfies the *contest's* roster-size requirement — there's no longer a
per-contest custom list to validate instead.

### 4.6a Applying the same event-owns-the-data boundary to the rest of `GolfTieredContestConfig`

§4.6 draws the line for tiers and price; a follow-up audit applied the identical test — is this
genuinely a per-pool *rule*, or is it event data that's drifted onto the contest — to every
other field on `GolfTieredContestConfig`.

**Delete: `cutRule`, `playoffHandling`, `displayScoring`, `tiebreaker`.** Their backing enums
(`GolfCutRuleType`, `GolfPlayoffHandling`, `GolfDisplayScoring`, `GolfTiebreakerType`,
`enums.ts:288-311`) each have **exactly one possible value** today, and the request DTO locks
the same single value (`z.enum([GolfPlayoffHandling.EXCLUDE_PLAYOFF_HOLES])`,
`contest-management.dto.ts:73-74`) — structurally incapable of varying per contest, which is a
stronger disqualifier than "not yet used for anything," and applies before even asking whether
they're event data or contest data. `cutRule.fixedScore` is the one field that could vary, but
it's written once as a hardcoded `80` by `derivePersistedTierConfig`'s mapper — already being
deleted — and read nowhere: the actual cut in play today is `participantStatus === 'MISSED_CUT'`
from uploaded round data (`golf-leaderboard-calculator.ts:205`), matching §9's existing note
that no cut-rule config is ever applied. All four are persisted via
`buildParticipantScoringConfig` (`contest-management/service.ts:635-644`) into a
`ParticipantContestScoringRuleRepository` JSON blob and threaded into `create-contest-page.tsx`,
`contest-entry-page.tsx`, root-admin content-configuration pages, and an email template
(`system-email-templates.ts:208,219`, `tiebreaker` as display text) — real writes and real UI
surface, zero real reads downstream. Delete the four types, their DTO fields,
`buildParticipantScoringConfig`'s write of them, and the frontend/email display surface. If a
real alternate cut rule or tiebreaker becomes a genuine product need later, it gets built to the
actual requirement then, the same standard already applied to `GOLF_CATEGORY_PICKS`.

**Keep, confirmed genuinely contest-level: `rosterSize` / `countedScores` / `pickCount`.**
`resolveGolfLeaderboardCountingRule` (`golf-leaderboard-calculator.ts:36-56`) reads
`countedScores` (falling back to `rosterSize`/`pickCount`) to build the real `BEST_N_GOLFERS`
counting rule, consumed by both the live leaderboard and `GolfContestSettlementService`
(`golf-contest-settlement-service.ts:123`). This is "how many of your drafted golfers actually
count toward your score" — two commissioners running pools on the *same* tournament can
legitimately pick different roster sizes; that's not event data duplicated onto the contest,
it's a real per-pool rule about how to use the event's shared data.

**Keep, confirmed genuinely contest-level and already correctly scoped: `budget` /
`pricingMethod`.** `budget-pick-engine.ts` implements real, functional salary-cap drafting
(`remaining = state.budget - totalSpent`), wired through the actual draft routes — not
decorative. Critically, it already reads the **event's** `SportEventParticipantGolfValuation.price`
as the per-golfer cost basis, never a per-contest price list — this is the one place a
violation of §4.6's boundary could plausibly have crept in, and it hasn't. `budget` (a
commissioner's total spending cap) and `pricingMethod` (a display-format string) are the
contest-level rule; the price itself stays exactly where §4.6 already puts it.

**Net shape**: `GolfTieredContestConfig` shrinks to `{ mode, rosterSize, countedScores }` plus
`budget`/`pricingMethod` (already living on `ContestConfiguration` proper, not this interface) —
`tierSource`, `tierGeneration`, `tiers` (§4.6), and now `cutRule`, `playoffHandling`,
`displayScoring`, `tiebreaker` (above) all delete. `GolfContestConfigMode.GOLF_CATEGORY_PICKS`
/ `GolfCategoryContestConfig` are also deleted now (§4.11) — as the dead, never-implemented
stub they are today, not preserved as a placeholder. `plans/127-golf-category-drafts.md`
rebuilds category picks later as a genuinely designed feature, on a clean slate, not by
resurrecting this stub. Once both are gone, `GolfContestConfig`'s union has exactly one member
— worth deciding at implementation time whether a union type is still justified or the type
collapses to a plain interface, though `plans/127`/`128` will likely reopen that question by
adding real members back.

**Swept `contest-management/service.ts`/`contests/service.ts`, found nothing else there — but
that sweep did not cover `drafts/routes.ts`, and a later, separate investigation found a real
one.** No other function in those two files writes odds/rank/price/tier/field data outside the
already-known `derivePersistedTierConfig` region — `contests/service.ts`'s `worldRanking`/
`oddsToWin`/`seedNumber` references are read-only `SELECT`s for leaderboard/field display, not
writes. No odds/rank override field exists anywhere under
`clients/poolmaster/src/features/contests` — confirms nothing beyond the tier/price read-only
display already planned (§6.3's commissioner-side change) needs the same treatment. **This did
not check `drafts/routes.ts`, which turned out to be the real, live reader `SportEventParticipantValuation`'s
doc comment wrongly claimed didn't exist — see §4.6b, a materially different and more important
finding than "found nothing."**

### 4.6b Rewiring the real draft room off the legacy tier/price tables

`drafts/routes.ts` (1492 lines) is the actual backend behind `getDraftState` — the endpoint the
member-facing pick UI already correctly consumes (confirmed by an earlier audit in this same
review). It is **not** built on `derivePersistedTierConfig`, `golf-tier-service.ts`, or either
of the dead `TieredPickEngine`/`BudgetPickEngine` classes (`modules/drafts/engine/` — confirmed
instantiated nowhere outside their own unit tests, a second instance of the
"competing/orphaned engine" pattern already found once in this plan for `tier-engine.ts`/
`pricing-engine.ts`, §4.8). It has its own, fully separate, working implementation, and that
implementation reads the legacy shape directly:

- **`deriveTierConfig`** (`drafts/routes.ts:267`) — two paths: (1) `contestConfiguration.tierConfig`
  (the legacy JSON array, already slated for deletion, §4.6), or (2) a fallback that groups
  participants by `participant.tier`, which traces to
  **`SportEventParticipant.valuations[0].tier`** — the exact legacy table §4.5 said had no other
  readers.
- **Price** — `loadDraftContext` (`drafts/routes.ts:~387`) and `buildRosterSelectionResponse`
  (`~579-584`, `~677`) read `valuations[0].price` — the same table, same fix.
- Both paths are **fully self-contained** in this file — zero calls into
  `golf-tier-service.getEffectiveTiersForContest` or any other shared service today.

**The fix**: `deriveTierConfig` and every price-reading call site above are rewritten to call
`golf-tier-service.getEffectiveTiersForContest(contestId)` (§4.6) instead — the one function
this plan already built to resolve a contest's tiers from its linked event's
`SportEventGolfTier`/`SportEventParticipantGolfValuation` rows. This is not new design, it's
finally pointing an already-planned shared function at its actual, previously-unaccounted-for
caller. `deriveTierConfig`'s legacy-JSON branch and its `valuations`-fallback branch both go
away entirely, replaced by one call.

**Sequencing consequence: `SportEventParticipantValuation` cannot be dropped in the same slice
that creates the new tier tables.** An earlier draft of the slice sequence (old slice 3) deleted
the legacy table immediately alongside creating `SportEventGolfTier`/
`SportEventParticipantGolfValuation` — safe only if nothing still read the old one. Now that
`drafts/routes.ts` is confirmed to, the table drop must wait until *after* this rewiring slice
lands, not happen concurrently with table creation. See the corrected slice sequence (§7).

**Confirmed, while investigating this, that budget drafting does not actually work today.**
`BUDGET_PICK` (`SelectionType`) is dispatched to the *identical* `buildRosterSelectionResponse`/
pick-validation code as `TIERED` — no separate grouping, no spend calculation. Pick validation
(`drafts/routes.ts:907-1184`) enforces `picksFromTier`/`rosterSize` for `TIERED`; `BUDGET_PICK`
falls into the same generic roster-size-only branch as every other format
(`~1156`) — price is display-only, nothing ever compares a running total against
`contestConfiguration.budget`. This isn't this plan's problem to fix — real budget-cap
enforcement is `plans/128-golf-budget-drafts.md`'s job — but it means the two-preset budget
work the user originally asked to seed here is **not** a small config addition; flagged so the
gap is recorded accurately rather than assumed working. Same finding for category mode:
zero references to `GolfContestConfigMode` or any category concept anywhere in `drafts/routes.ts`
— confirmed unimplemented at every layer, not just the deleted DTO stub. That's
`plans/127-golf-category-drafts.md`'s job.

**One thing that makes both follow-on plans easier**: `getDraftState`'s response contract
(`DraftStateResponseSchema`, `drafts.dto.ts:194`) is **already a generic, non-discriminated
shape** — `selectionGroups` (`groupId`/`groupName`/`groupNumber`/`picksFromGroup`/`participants`)
is already reused identically for `TIERED` and `BUDGET_PICK` today. A category mode can reuse
this exact shape (one group per category) with **zero DTO/contract changes** — confirmed by
reading the schema, not assumed. `plans/127`/`128` are backend-population and validation-logic
work, not API redesigns.

### 4.6c Seeding real `ContestConfigTemplate` presets — tiered only, here; category/budget deferred

`ContestConfigTemplate` needs no create/edit UI (confirmed: root-admin's template pages only
list/edit, and no create action was found in either) — presets are authored once, as data, via
a migration seed. Per the user's direction, this plan seeds only the **tiered** presets;
category and budget presets are `plans/127`/`128`'s own sections (§6 of each), seeded once
those modes actually work end to end, not before.

Two tiered presets, both riding on the same `golf-tier-service.getEffectiveTiersForContest`
resolution (§4.6) once §4.6b's rewiring lands:

| Preset | Pick shape | Counting rule |
|---|---|---|
| Tiered — Top 4 of 6 (default) | Pick 1 golfer from each of 6 tiers (§4.5a's default tier structure) | Best 4 of 6 count |
| Tiered — Top 8 of 12 | Pick 2 golfers from each of 6 tiers (12 total) | Best 8 of 12 count |

```ts
interface GolfTieredContestConfig {
  mode: 'GOLF_TIERED';
  rosterSize: number;    // 6 or 12
  countedScores: number; // 4 or 8
}
```

Matches §4.6a's already-trimmed shape exactly — no `tierSource`/`tierGeneration`/`tiers`/
`cutRule`/etc. fields, since tier *definitions* always come from the linked event
(`SportEventGolfTier`), never from the template. A template only ever needs to say "how many
picks, how many count" — the tier structure itself is a property of the tournament, not the
contest format. "Default for tiers" (the first preset) means: whichever preset a commissioner's
create-contest flow pre-selects when they choose a tiered format with no other input, matching
the default 6-tier/10-per-tier structure §4.5a already establishes as golf's own default.

New pure module `packages/core-api/src/modules/golf/golf-seeding-algorithm.ts`, unit-tested
in isolation from any I/O, called from `golf-field-service.seedFieldFromLeagueRoster`:

1. Resolve the tournament's league (`SportEvent.seasonId → Season.sportLeagueId`) and read
   `ParticipantLeagueAffiliation` rows for that league where the affiliated `Participant.status
   = ACTIVE` (§4.2) — the live, current roster, not a season snapshot.
2. **Tie-broken rank position.** Sort ascending by `worldRanking` (nulls last). Within a tie,
   shuffle using an injectable `random: () => number` (defaults to `Math.random`; tests
   inject a fixed sequence for determinism — the same dependency-injection pattern already
   used for `now()` in `ScenarioStoreOptions`). Assign `position = 1..N`. **This position is
   `seedNumber` directly** — seeds can't repeat, world rankings can tie, so the tie-break is
   exactly what turns one into the other.
3. **`oddsToWin`, derived from `position`** (not the raw, tie-having `worldRanking`, so two
   tied golfers never split a weight down the middle):
   - `weight(i) = 1 / position(i)` — higher rank (lower position number) ⇒ larger weight ⇒
     shorter odds.
   - `jitter(i) = 1 + (random() * 0.30 - 0.15)` — a ±15% randomized weighting factor, since
     there is no real signal beyond rank to differentiate two adjacently-ranked golfers.
   - Normalize `weight(i) * jitter(i)` across the full field into a probability distribution
     summing to 1.
   - `oddsToWin(i) = round(1 / probability(i), 2)`.
4. Write `SportEventParticipant.{worldRanking, seedNumber, oddsToWin}` from the league roster's
   current values plus these derived values.

This is deliberately a simple placeholder — there is no market-odds signal to draw on yet —
flagged in the open questions (§9). It runs **once, at seed time**, never silently re-runs;
the field bulk-patch endpoint (§5.2) and the round-scores upload remain the correction path
afterward. Document the unit/meaning of `oddsToWin` via `.describe()` on the DTO field now
that it is admin-authored rather than an opaque provider passthrough.

### 4.7a Price derivation — same algorithm, a later action, a different range

`adminAutoAssignGolfPrices` (§5.2) is a separate, later action from field-seeding — it runs
whenever the admin decides to (typically once tiers are also being set, ahead of field lock),
not automatically at seed time — so it needs its own random draw, not a reuse of the odds
jitter from step 3 above. Same sibling function in `golf-seeding-algorithm.ts`, same shape:

1. Use the field's already-assigned `seedNumber` as `position` (no re-sort — the tie-break
   happened once, at seed time; price ordering follows the same position, not a fresh
   world-ranking sort that could resolve ties differently).
2. `weight(i) = 1 / position(i)`, `jitter(i) = 1 + (random() * 0.30 - 0.15)` — same formula,
   fresh random values, since this is a distinct action from odds derivation.
3. Min-max normalize `weight(i) * jitter(i)` across the field into `proportion(i) ∈ [0, 1]`.
4. `price(i) = round(minPrice + proportion(i) * (maxPrice - minPrice), 2)` — the best-ranked
   golfer lands near `maxPrice`, the worst-ranked near `minPrice`, everyone else interpolated
   by relative weight. `minPrice`/`maxPrice` are the action's own body parameters (§5.2), not
   hardcoded — there's no established currency/points scale to assume one for.

Same caveat as odds: a first-pass placeholder, not calibrated against real budget-format
contest play (there isn't any yet), tunable later in this one function without touching the
tier side at all — the two are independent actions sharing only the ordering they both read.

### 4.8 Dead code removed in the same slice

Removed because this plan's own changes make them dead — a direct, mechanical consequence,
not a drive-by cleanup (§4.11 has those):

- `modules/participants/tier-engine.ts` and `pricing-engine.ts` — a second, competing tier
  engine referenced only by `tests/unit/core-api/participant-valuation-helpers.test.ts`. Two
  tier engines is exactly the drift these rules exist to prevent — delete both plus that test
  when `golf-tier-service.ts` lands.
- `GolfContestTierDefinition` / `PersistedGolfContestTierDefinition`
  (`packages/shared/domain/contest-management-types.ts`) — verified their only backend
  consumer is `derivePersistedTierConfig` (already deleted, §4.6) and the legacy
  `ContestConfiguration.tierConfig` field (already dropped, §4.6). Once both are gone these
  types have zero remaining consumers. Delete alongside them, not as a separate follow-up.

### 4.9 Impact assessment: extending this pattern to other sports

Not a slice in this plan — this is the assessment the user asked for, to scope future,
separate epics. Every sport genuinely has a season: the 2026 NFL season, the 2027 NCAA
Tournament, the 2026 World Cup. The reason `SportEvent.seasonId` isn't universally populated
today is a real gap in the *existing* ingestion pipeline (nothing currently writes `Season`
for any sport), not a claim that some sports lack seasons.

**The confirmed direction removes the hardest part of this assessment.** An earlier draft of
this section assumed the future work was "teach ingestion to auto-resolve which season (and
implicitly which league) an incoming, auto-created provider event belongs to" — and treated
that as genuinely hard, needing different boundary-detection logic per league (a recurring
calendar window for NFL/NBA, a single bracket for NCAA Tournament, a four-year cycle for a
World Cup) and, for a sport with more than one simultaneously-synced league, no reliable way
to tell which league an under-specified payload belongs to at all. That problem doesn't need
solving, because its premise is wrong: PoolMaster events are never meant to be auto-created
from a provider feed in the first place. Every sport should follow exactly the pattern this
plan builds for golf — an admin authors the event (season, and therefore league and sport,
fixed at creation, §4.3) and, separately, links it to a provider's external event purely for
score polling (§4.4). Since the league and season are already fixed before a link ever exists,
there is nothing for ingestion to guess. This also means "teach ingestion to write
`ParticipantLeagueAffiliation` rows automatically" isn't needed either — rosters are
admin-maintained per sport the same way golf's league-roster tooling (§3.2, already
cross-sport) works, not synced.

Given that, extending this to another sport is much smaller than "extend the ingestion
pipeline" — it's "build that sport's admin plan," mirroring this one:

1. **A new route lane** (`/sports/basketball/*`, `/sports/football/*`, …) and whatever
   sport-specific business logic that sport actually needs (bracket seeding for NCAA
   Tournament, conference tie-breakers, whatever golf's tiers/scoring are the golf-shaped
   analogue of) — the new plan's own `modules/basketball/` or `modules/football/`, mirroring
   `modules/golf/` (§3.1).
2. **Zero new tables.** `SportLeague`, `Season`, `ParticipantLeagueAffiliation` (§4.2) and the
   `modules/sport-catalog/` service (§3.2) are already sport-agnostic; a new sport's admin
   routes are thin wrappers scoped to its own `Sport` value, exactly like golf's are scoped to
   `GOLF` (§5.2).
3. **Zero new linking mechanism.** `event-score-source-service.ts` (§3.4) and `syncScope`
   (§4.4) already operate on the generic `SportEvent` columns — a new sport's admin routes
   call the same service for linking/unlinking, with no sport-specific logic to add there
   either.
4. **The adapter itself is the only genuinely new work per sport**, and it was already going
   to be needed regardless of this plan. `espn-adapter.ts`/`openf1-adapter.ts` used to sit here
   as placeholders for that future work — they're deleted instead (§4.11), since neither was
   ever configured, tested, or backed by a real subscription, and there's no NFL/F1 product
   surface today for them to serve. That's not a loss for this argument: whenever a real
   other-sport epic actually starts, it writes its own adapter from scratch against whatever
   that provider's real contract turns out to be — which is a *better* starting point than
   reusing a speculative implementation that was never validated against a live subscription
   in the first place. Implementing `getLiveScores`/`getEventResults` for a real sport is that
   future adapter's own scope, unrelated to season/league modeling either way.
5. **No migration risk, because there's nothing live to migrate.** `registerConfiguredProviders`
   (`provider-bindings.ts`) only ever activates one configured provider today, and it's the
   mock golf feed — no other sport is actually syncing in any environment right now. A future
   sport's admin plan adopts admin-authored events + score-only linking from day one; there is
   no existing auto-created-event behavior for that sport to preserve or migrate away from.

The remaining open question is narrower than "redesign ingestion": whether `SportEvent.sport`
(the bare string, still load-bearing for the one sport — golf — actually syncing today) is
ever worth retiring in favor of deriving it from the season chain. That's a real but small
cleanup, safely deferred indefinitely — nothing in this plan or in a future per-sport plan
depends on it changing.

6. **Tiers, price, and category valuation are deliberately golf-scoped for now, and that's a
   known, accepted trade-off, not an oversight.** `SportEventGolfTier`,
   `SportEventParticipantGolfValuation`, and `plans/127`'s `SportEventParticipantGolfCategory`
   are golf-named tables in `modules/golf/`, even though "assign a per-participant draft value"
   and "classify a participant into a pick bucket" are not conceptually golf-specific — a
   points-based NFL pick pool or an NCAA bracket pool could plausibly want the identical
   shape. Unlike `SportLeague`/`Season`/`ParticipantLeagueAffiliation` (§4.2), which were built
   cross-sport from the start because golf's *own* stated requirements immediately proved the
   need (separate non-overlapping rosters per tour), there is no second sport's concrete
   requirements to design a shared valuation/category shape against yet — generalizing now
   would be exactly the kind of speculative, build-ahead-of-need work this plan has repeatedly
   rejected elsewhere (the deleted `espn-adapter.ts`/`openf1-adapter.ts`, the deleted
   `GOLF_CATEGORY_PICKS` stub). The explicit decision: **ship golf, fully, with all its draft
   types (`plans/124`, `127`, `128`), before looking for cross-sport commonality.** When a
   second sport's admin plan actually gets designed, expect a real refactoring pass then —
   likely renaming/relocating these tables into a shared `modules/sport-catalog/`-style tier —
   informed by that sport's actual shape, not guessed at now. `plans/128`'s open question 1
   (whether budget drafting needs a golf-specific `GolfContestConfigMode` value at all) is
   resolved the same way: yes, ship it golf-scoped for now; revisit when a second sport needs
   the same mechanic.

### 4.10 Round schedule & algorithmic lifecycle transitions

The schema §3.6's scheduler reads from. Two additive pieces, both on/around `SportEvent`:

```prisma
/// A scheduled sub-period of a SportEvent with its own start/end time — a golf
/// tournament's Round 2, an NFL Week's set of games, a World Cup's match day.
/// Cross-sport by shape (mirrors SportLeague/Season's pattern, §4.2); this
/// plan populates and uses it only for golf rounds.
model SportEventRound {
  id             String    @id @default(uuid()) @db.Uuid
  sportEventId   String    @map("sport_event_id") @db.Uuid
  roundNumber    Int       @map("round_number")
  scheduledDate  DateTime  @map("scheduled_date") @db.Timestamptz
  scheduledEndAt DateTime? @map("scheduled_end_at") @db.Timestamptz
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  sportEvent SportEvent @relation(fields: [sportEventId], references: [id])

  @@unique([sportEventId, roundNumber])
  @@map("sport_event_rounds")
}

// SportEvent:
autoLifecycleEnabled Boolean @default(true) @map("auto_lifecycle_enabled")
```

This is a genuinely different table from the pre-existing `SportEventParticipantGolfRound`
(plan 117; §3.1's `golf-score-service.ts` writes it) — that one holds one golfer's *result*
for a round; this one holds the round's own *schedule*, independent of any participant.
Confusing the two would be exactly the kind of column-meaning ambiguity
`rules/domain-model-conventions-rules.md` §9 warns against, so they stay physically separate
tables even though the names are close.

**Defaults, not requirements.** At tournament creation (`adminCreateGolfTournament`, §5.2),
`SportEventRound` rows are created automatically — one per `rounds` — defaulting to
sequential daily dates starting at `startDate` (the "usually 4 sequential dates" convenience).
Every date is individually editable afterward (§6.3): a rain delay pushing Round 3 to a fifth
day is an admin edit to one row, not a modeling gap. `autoLifecycleEnabled` is the tournament-level
escape hatch — set it false and the scheduler (§3.6) leaves that tournament's status alone
entirely, no matter what the recorded round dates say; the admin drives it by hand from that
point on, same workflow rail as before this feature existed.

**`SportEventParticipantGolfRound` gains a real FK to `SportEventRound`, replacing its bare
`round: Int`.** Today nothing stops a stray write from recording a result for "round 7" of a
4-round tournament — `round` is an unvalidated integer, not checked against how many rounds
the event actually has. Once every golf `SportEvent` has real `SportEventRound` rows (below),
that's fixable at the storage layer instead of trusted to application code:

```prisma
model SportEventParticipantGolfRound {
  id                      String    @id @default(uuid()) @db.Uuid
  sportEventParticipantId String    @map("sport_event_participant_id") @db.Uuid
  sportEventRoundId       String    @map("sport_event_round_id") @db.Uuid   // replaces `round: Int`
  strokes                 Int
  scoreToPar              Int       @map("score_to_par")
  thru                    Int?
  status                  String    @default("PENDING") @db.VarChar(20)
  completedAt             DateTime? @map("completed_at") @db.Timestamptz
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  sportEventParticipant SportEventParticipant @relation(fields: [sportEventParticipantId], references: [id])
  sportEventRound       SportEventRound       @relation(fields: [sportEventRoundId], references: [id])

  @@unique([sportEventParticipantId, sportEventRoundId])
  @@map("sport_event_participant_golf_rounds")
}
```

A round number that doesn't exist for this event now fails at insert time with a foreign-key
violation, not at read time with a confused leaderboard row — exactly the "failure proximity"
test in `rules/domain-model-conventions-rules.md` §9. It also directly delivers the "show all
Round 3 scores" case: one join through `SportEventRound` gives every participant's result for
a round *and* that round's own scheduled date/label together, instead of independently
correlating a bare integer between two tables with no formal relationship. `roundNumber` is no
longer stored on this table at all — it's read through the FK, one canonical source
(`SportEventRound.roundNumber`), never duplicated.

**Every golf `SportEvent` now gets its `SportEventRound` rows from an admin-triggered creation
path, with no ingestion involvement at all** — simpler than an earlier draft of this section
assumed, because `plans/125` §3.1 later deleted `EVENTSCHEDULE` (and its
`persistEventsWithDiagnostics` status-driving call) entirely rather than leaving it as an idle
legacy fallback. `persistEventsWithDiagnostics` was the only thing that could create a golf
`SportEvent` outside admin action; with it gone, and per this repo's no-production-data
clean-rework convention (invoked again below for this same table), there is no legacy event
anywhere that reaches `EVENTLIVESCORES`/`persistGolfRounds` without having first gone through
either
`adminCreateGolfTournament` or `adminCreateGolfTournamentFromProviderEvent` (§4.4a) — both of
which populate `SportEventRound` at creation via `ensureSportEventRounds`. **A separate,
verified finding from the same pass: `persistEventDetailWithDiagnostics` — the function
`EVENTPARTICIPANTS`'s `runEventFieldSync` still calls, and `EVENTPARTICIPANTS` is *not* being
deleted — internally calls the same `persistEventsWithDiagnostics`, which unconditionally
writes `SportEvent.status` and fires `activateContestsForStartedEvent`/
`settleContestsForCompletedEvent` on every call** (`ingestion-persistence.ts:98-184`, read
directly, not assumed). That means, as the code stands today, routinely refreshing a linked
tournament's field (§4.4a's Step 2, or the equivalent generic sync-lane action) would silently
overwrite an admin-driven `SportEvent.status` with whatever the provider reports and fire
contest activation/settlement as a side effect of a field refresh — directly contradicting
§3.2's "admin always drives status transitions manually" premise. **Fix, folded into the same
slice as `golf-field-service.seedFieldFromProvider`'s extraction (§4.4a, slice 13):**
`runEventFieldSync` calls `seedFieldFromProvider` instead of `persistEventDetailWithDiagnostics`
for admin-managed events — the narrower participant-matching logic it's built from, with no
event-row upsert and no status write, so a field refresh can never again touch lifecycle state.
`persistEventDetailWithDiagnostics`/`persistEventsWithDiagnostics` remain as-is for whatever
non-golf/legacy callers still exist; this plan only changes what `EVENTPARTICIPANTS` calls for
golf's admin-managed events.

`persistGolfRounds` resolves `round: number → SportEventRound.id` via the same
`(sportEventId, roundNumber)` unique key before writing, mirroring how it already resolves
`participantExternalId → SportEventParticipant.id`. **`roundNumber` is the only resolution
key, for both writers** — the admin-facing `golf-score-service.ts` and the sync-facing
`persistGolfRounds` both match "round 3" to "round 3," a plain integer comparison; `scheduledDate`
is never part of that lookup. It exists solely for the two things dates are actually for:
the lifecycle scheduler's due-transition check (§3.6, genuinely date-driven — "has the clock
passed this timestamp") and display (the round selector's date label, §6.3). Reads that need
rounds in order (`adminGetGolfTournamentRounds`, §5.2; the round selector) sort by
`roundNumber`, not by `scheduledDate` — they move together in the ordinary case, but
`roundNumber` is the one that's actually load-bearing for "where does Round 3's data go" and
"what order do the rounds display in." No backfill migration is needed — per this
repo's established no-data clean-rework convention (used by plan 117's own migration), there is
no production data in `sport_event_participant_golf_rounds` to preserve.

### 4.11 Unrelated cleanup riding along with this epic

Found during a dead-code audit prompted by this plan's own changes, but not *caused* by
them — the opposite of §4.8. Each verified with grep/read before listing, not assumed:

- **`PrismaSport` enum** (`schema.prisma`) — orphaned. It's not the type of any column and has
  zero references anywhere in `packages/core-api/src` or `packages/shared` beyond its own
  declaration. `PrismaSportCategory` is the one actually wired to `Sport.category` and read by
  real code (`score-publisher.ts`, `ingestion-scheduler.ts`). Looks like scaffolding left over
  from before `.category` existed. Delete the enum; zero-risk, nothing references it.
- **`ContestSportEvent`** (the M:N `Contest`↔`SportEvent` join table, `plans/117`) — zero
  writers anywhere; `contests/service.ts` writes only `Contest.sportEventId` directly, and the
  one place `ContestSportEvent` is read is a defensive fallback that only makes sense because
  the join table isn't reliably populated. Built ahead of need for multi-event contest types
  (NFL weekly pick'em, F1 season-long) that don't exist yet. Dropped now rather than kept as
  dormant scaffolding — a future multi-event contest epic rebuilds it to whatever shape it
  actually needs then, the same way every table in this plan got built fresh when a real
  feature needed it. This is `plans/117`'s design surface, not golf-admin's; noting it here
  because this is where the decision to drop it was made, not because it's part of this
  epic's own data model.
- **`GolfContestConfigMode.GOLF_CATEGORY_PICKS` / `GolfCategoryContestConfig`**
  (`packages/shared/domain/enums.ts`, `contest-management-types.ts`) — fully defined at the
  DTO/type/generated-client layer, zero backend implementation anywhere: no route, no service
  branch, no scoring logic in `contest-management/service.ts`, `contests/service.ts`,
  `golf-leaderboard-calculator.ts`, `golf-contest-settlement-service.ts`, or (verified in a
  later pass) `drafts/routes.ts` — the actual live draft-room backend. A fully-typed contract
  nobody implements. Delete the mode, its DTOs, its generated-client references, and the live
  `create-contest-page.tsx` UI branch that submits it (`ContestMode` state, category pickers,
  a full second submit path — found during a later frontend audit, real code, still dead).
  **It is coming back for real**: `plans/127-golf-category-drafts.md` rebuilds category picks
  on a clean slate — new schema for category assignment, new `SelectionType`, new
  `drafts/routes.ts` dispatch — deliberately not by resurrecting this stub. Deleting it now and
  designing it properly later is cheaper and safer than keeping a half-typed placeholder around
  in the meantime.
- **`espn-adapter.ts` / `openf1-adapter.ts`** (`modules/ingestion/adapters/`) — real,
  compiling implementations (296/236 lines), registered in `provider-bindings.ts`'s
  `providerFactories` map, but that's the only place either name appears outside its own
  file: zero test coverage anywhere in `tests/`, zero env/config/docker-compose reference,
  never instantiated or exercised. And there's no second sport for them to serve — a direct
  grep for other-sport business logic anywhere in `packages/core-api/src/modules` turns up
  nothing real (the apparent hits were regex noise, e.g. `conflictingUserId` matching `nfl` as
  a substring of "co**nfl**ict"). PoolMaster has no NFL/F1 product surface today and isn't
  subscribing to either data feed. "Compiles and is registered" isn't the same as "serves a
  purpose" — delete both files and their `providerFactories` entries. If a real NFL or F1
  product effort ever starts, that epic writes the adapter against whatever that provider's
  actual contract turns out to be, the same way every other table/service in this plan got
  built to spec when a real feature needed it, not ahead of time on spec.

A follow-up audit of `packages/mock-contest-feed-provider/` prompted by this same cleanup
discipline found three more items, verified the same way:

- **`golf-late-correction` / `golf-r4-complete-pending-final` mock event states**
  (`scenario-store.ts`'s `GolfLiveState`/`MockEventStateKind`) — built specifically to
  exercise `plans/122`'s now-dropped `COMPLETED → OFFICIAL` corrections workflow (a scorecard
  revision arriving after the tournament is otherwise final). No core-api test references
  either token — only the mock package's own contract test enumerates them. Delete both
  states and their branches in `scenario-store.ts`, their `contracts.ts` enum entries, and
  the generated OpenAPI/SDK literals they produce.
- **`golf-playoff` mock event state** — modeled as a synthetic Round 5 for the two tied
  leaders. That's the wrong shape for the domain, not just an unused one: a golf playoff is
  sudden-death extra holes (19, 20, ...) appended to the final stroke-play round's card for
  just the tied players, updating that round's strokes/`scoreToPar` and the tournament total
  — never a new round. It's exercised only by the mock package's own self-consistency test
  (`scenario-store.test.ts`); no core-api integration or FAPI test ever sends `golf-playoff`
  through ingestion, so PoolMaster's persistence layer has never actually been proven to
  handle it, unlike `golf-correction` (kept — proven end-to-end by
  `tests/integration/core-api/mock-contest-feed-provider.integration.ts:1014`, which resyncs
  an already-`COMPLETED` round with a revised score and asserts the change reaches a live
  contest leaderboard's `totalScoreToPar`). Delete the `golf-playoff` state, its
  `withPlayoffRounds`/`playoff` branch in `scenario-store.ts`, and its `contracts.ts`/
  generated-client entries. If golf playoff scoring becomes real product work later, it's
  additional strokes on the existing final round's `SportEventParticipantGolfRound` row, not
  a new `SportEventRound` — this deletion implies no schema change.
- **`tennis-grand-slam-2026.json` / `ncaa-team-tournament-2026.json` fixtures**
  (`packages/mock-contest-feed-provider/contest-feed-scenarios/`) — unreachable in production
  (only golf is ever configured via `registerConfiguredProviders`, per §4.9) and not loaded by
  any test. Delete both files.
- **`TEAM_TOURNAMENT` mock sport + `correction-and-tie-2026.json`** — revisiting the earlier
  call to keep this fixture. `TEAM_TOURNAMENT` appears in exactly four places: `contracts.ts`'s
  `supportedSports`, this one fixture, the adapter's exclusion branch in `toDomainSport`, and
  the one test guarding it (`pool-master-rop.78.13`). It was never a real sport PoolMaster
  supported and later dropped — it exists solely to be excluded, permanently advertised in the
  mock's public generated contract for that sole purpose. The bug that test guards against —
  the adapter's local sport union silently drifting out of sync with the mock's generated
  SDK — is now prevented structurally, independent of any specific literal:
  `SupportedMockSport` (`mock-contest-feed-adapter.ts:38`) is
  `type SupportedMockSport = ScenarioSummaryResponse['scenarios'][number]['sport']`, derived
  directly from the generated SDK type rather than hand-duplicated. Any sport the mock adds in
  the future is automatically part of this type, so `toDomainSport`'s switch (return type
  `Sport | null`, no default arm) fails to compile on an unhandled case regardless of which
  literal is missing — that is the real, permanent fix, and it does not depend on
  `TEAM_TOURNAMENT` continuing to exist. Delete `TEAM_TOURNAMENT` from `contracts.ts`'s
  `supportedSports`, delete `correction-and-tie-2026.json`, and retire the
  `pool-master-rop.78.13` test case — the regression it proves is now covered generally, at
  the type level, not by one specific fixture.

`ParticipantRankingSnapshot`'s retirement, and the mock provider's own `rankings` feed kind
(`getRankings`, its `scenario-store.ts` records, and the `getMockContestFeedRankingsSnapshot`
endpoint), are the last items from this same audit, but they're sync-feed-shaped, not
golf-admin-shaped — both are covered in `plans/125` §3.2a, which already owns the
`PARTICIPANTRANKINGS` feed's fate.

---

## 5. API surface

### 5.1 Route lane separation

| Prefix | Tag | Purpose |
|---|---|---|
| `/api/v1/admin/providers/*` | `Admin Sync` *(retag)* | Provider health, sync runs, manual sync triggers, mappings, cleanup — **unchanged behavior**, plus one new catalog-browse endpoint (below) |
| `/api/v1/admin/sports/golf/*` | `Admin Golf` *(new)* | Golf tournament authoring |
| `/api/v1/admin/*` (users, leagues, teams, health, audit, config) | `Admin` | Platform administration |

Registered as a sub-plugin from `adminModule`, so the existing `adminAuth` plugin already
covers it — new routes need no per-route guard. Add the two new tags to
`packages/core-api/src/plugins/swagger.ts` (its tag list is fixed) and add
`Admin Sync` to the existing provider routes. That retag is doc-only: no operationId, path,
or payload changes, so the generated SDK and every frontend caller are untouched.

New files: `modules/admin/golf/{routes.ts, handler.ts}` — thin, per `rules/service-rules.md`
§3/§4 (no Prisma, no `.map()`, no inline schemas). All DTOs land in a new
`packages/shared/dto/admin-golf.dto.ts`.

One new endpoint lives in the **sync lane**, not the golf lane, because it is fundamentally
about a provider's catalog rather than golf domain state — it stays reusable when basketball
needs the same linking mechanism later:

| Method + path | operationId | Notes |
|---|---|---|
| `GET /providers/:providerId/catalog-events` | `adminListProviderCatalogEvents` | Query `{ sport, sportLeagueId?, from?, to?, search? }` (`sportLeagueId`/`from`/`to` added for §4.4a's league-scoped browse; all optional, existing callers unaffected). Calls `provider.getUpcomingEvents(sport, dateRange)` **live** — no dependency on any persisted `SportEvent` row or on schedule/field sync being enabled. `sportLeagueId` resolves to that league's `matchKeyword` and applies a plain substring filter, not a scored ranking (§4.4). **The only candidate-lookup operation** — serves the tournament-creation browse mode (§4.4a) and the score-source linking picker (§6.3, passing the tournament's own date window as `from`/`to` and its league as `sportLeagueId` — no separate candidates endpoint). Returns `{ externalId, name, startDate, endDate, status }[]`. |

### 5.2 New operations

**Golf leagues** (real-world tour/organization catalog, thin wrappers over the shared
`sport-league-service.ts` — §3.2, §4.2 — scoped to `Sport = GOLF`; UI copy calls this "Tour"
since that's golf's own vocabulary, §6.3)

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/leagues` | `adminListGolfLeagues` | Filters: `isActive`. Returns roster size + season count per tour — this is the "global list by league." |
| `POST /sports/golf/leagues` | `adminCreateGolfLeague` | `{ name, matchKeyword? }`, e.g. `{ name: "PGA Tour", matchKeyword: "PGA" }`. Adding "Champions Tour" later is one call here, not a migration. |
| `PATCH /sports/golf/leagues/:leagueId` | `adminUpdateGolfLeague` | Rename, edit `matchKeyword`, or deactivate. |
| `GET /sports/golf/leagues/:leagueId/roster` | `adminGetGolfLeagueRoster` | Roster rows: golfer identity, `worldRanking`, `Participant.status` (§4.2 — not season-scoped, this league's current roster). |
| `POST /sports/golf/leagues/:leagueId/roster` | `adminAddGolfLeagueRosterEntry` | Add one golfer (picker over `adminListGolfPlayers`) — creates the `ParticipantLeagueAffiliation` row. |
| `DELETE /sports/golf/leagues/:leagueId/roster/:participantId` | `adminRemoveGolfLeagueRosterEntry` | Removes the affiliation row (a golfer leaving the tour entirely) — distinct from retiring (`Participant.status = INACTIVE`, §4.2), which isn't league-specific. |
| `PATCH /sports/golf/leagues/:leagueId/roster` | `adminUpdateGolfLeagueRoster` | Bulk row patch (`worldRanking`) — same shape as the field bulk-patch (§ Field, below). |
| `POST /sports/golf/leagues/:leagueId/roster/preview` | `adminPreviewGolfLeagueRosterUpload` | **Dry run.** Same CSV/JSON paste-or-upload pattern as round scores (§ Scores): resolves rows to existing `Participant`s and reports unresolved ones — it never silently creates a golfer record from an upload row. |
| `POST /sports/golf/leagues/:leagueId/roster/apply` | `adminApplyGolfLeagueRosterUpload` | Applies a previewed upload. `422` when any row is unresolved. |

**Seasons** (the tournament-calendar grouping for one year of a league — §4.2, §4.3)

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/seasons` | `adminListGolfSeasons` | Filters: `isActive`, `sportLeagueId` — the "global list by league and season": pass a league's id to see just its seasons (e.g. all "PGA Tour" seasons across years). Returns linked tournament count per season. |
| `POST /sports/golf/seasons` | `adminCreateGolfSeason` | `{ name, year, startDate, endDate, sportLeagueId }`, e.g. `"PGA Tour 2026"` linked to the `PGA Tour` `SportLeague` row. `409 SEASON_YEAR_ALREADY_EXISTS` if that league already has a season for `year` (§4.2's `@@unique`). |
| `GET /sports/golf/seasons/:seasonId` | `adminGetGolfSeason` | Season detail + tournament count + `isCurrent` (derived: does `sportLeague.currentSeasonId` equal this season's id). |
| `PATCH /sports/golf/seasons/:seasonId` | `adminUpdateGolfSeason` | |
| `POST /sports/golf/seasons/:seasonId/set-current` | `adminSetCurrentGolfSeason` | Sets this season as its league's `currentSeasonId` (§4.2) — a single atomic write on the parent `SportLeague` row, so there's no separate "unset the old one" step and no window where a league has zero or two current seasons. The admin action for the year-turnover moment described in §4.2. |
| `POST /sports/golf/seasons/:seasonId/clone` | `adminCloneGolfSeason` | Body `{ targetYear? }`, defaulting to source year + 1 (§4.2a). Re-creates each source-season tournament as a fresh, empty, `syncScope=NONE` tournament with dates shifted one calendar year — never a raw row copy of field/tier/score/provider-link data, and no roster to copy at all (§4.2). Does not change `currentSeasonId`. Returns `{ season, tournamentsCloned }`. `409 SEASON_YEAR_ALREADY_EXISTS` if the target year already exists for this league. |

**Tournaments**

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/tournaments` | `adminListGolfTournaments` | Filters: `status`, `syncScope` (`NONE`\|`SCORES_ONLY`\|`FULL`\|`ALL`), `search`. Returns canonical `AdminGolfTournamentDto` (event + readiness + field counts + tier count + contest count + score-source summary). |
| `POST /sports/golf/tournaments` | `adminCreateGolfTournament` | Body from `AdminGolfTournamentDtoSchema.pick(...)`: `name`, `venue?`, `location?`, `startDate`, `endDate?`, `rounds` (default 4), `parForRound?`, `releaseAt`, `fieldLocksAt`, **`seasonId`** (required, not optional — §4.3), `autoLifecycleEnabled?` (default `true`, §4.10). Server assigns `providerId=manual-admin`, `externalId=manual-<uuid>`, `status=SCHEDULED`, `syncScope=NONE`, creates one `SportEventRound` per `rounds` defaulting to sequential daily dates from `startDate`, and calls `golf-tier-service.ensureDefaultGolfTiers` (§4.5a) to seed the 6 default tier rows. `422 SEASON_SPORT_MISMATCH` if `seasonId` resolves to a non-golf season. |
| `POST /sports/golf/tournaments/from-provider-event` | `adminCreateGolfTournamentFromProviderEvent` | Body `{ seasonId, providerId, externalId, rounds? }` — `externalId` from a prior `adminListProviderCatalogEvents` browse (§4.4a). Creates the tournament pre-linked (`syncScope=SCORES_ONLY`, real `providerId`/`externalId`, no placeholder identity), name/venue/`startDate`/`endDate` from `event-score-source-service.getProviderEventDetail` (§3.4 — the full extent of that contract — no per-round dates or round count to read, §4.4a), `rounds` admin-set/defaulted to 4 same as manual create, rounds rows via `ensureSportEventRounds`, and the same `ensureDefaultGolfTiers` tier-seeding step (§4.5a) as manual create. **Does not touch the field** — that is `adminRefreshGolfTournamentField`'s job, a separate, explicit action (§4.4a). `422 SEASON_SPORT_MISMATCH`, same as the manual create. |
| `GET /sports/golf/tournaments/:eventId` | `adminGetGolfTournament` | Canonical DTO + workflow block (current status, allowed transitions, blocking reasons, **next scheduled auto-transition and its date when `autoLifecycleEnabled`**) + score-source block (linked provider/externalId, or unlinked). |
| `PATCH /sports/golf/tournaments/:eventId` | `adminUpdateGolfTournament` | `.partial()` of the create body **minus `seasonId`** — a tournament's season is immutable after creation (§4.3), not part of this update surface. Includes toggling `autoLifecycleEnabled`. `409 EVENT_NOT_ADMIN_MANAGED` when `syncScope === 'FULL'` (§3.5, §4.4). |
| `DELETE /sports/golf/tournaments/:eventId` | `adminDeleteGolfTournament` | Hard delete; `409 EVENT_HAS_CONTESTS` when any `Contest.sportEventId` references it (§4.11 — `ContestSportEvent` is dropped, `sportEventId` is the only reference path left). |
| `POST /sports/golf/tournaments/:eventId/transitions` | `adminTransitionGolfTournament` | Body `{ toStatus, fieldLocked? }`. Routes to `applySportEventStatusTransition` with `actor: { type: 'ROOT_ADMIN', ... }` — the same function §3.6's scheduler calls with `actor: { type: 'SYSTEM' }`. `422 SPORT_EVENT_INVALID_TRANSITION`. |
| `GET /sports/golf/tournaments/:eventId/rounds` | `adminGetGolfTournamentRounds` | The `SportEventRound` schedule rows (§4.10) — round number, scheduled date, scheduled end. Ordered by `roundNumber` ascending, not by date. |
| `PATCH /sports/golf/tournaments/:eventId/rounds` | `adminUpdateGolfTournamentRounds` | Bulk row patch: `{ rounds: [{ roundNumber, scheduledDate, scheduledEndAt? }] }` — how a rain delay or an irregular (non-daily) schedule gets recorded. |
| `POST /sports/golf/tournaments/:eventId/score-source` | `adminLinkGolfTournamentScoreSource` | Body `{ providerId, externalId }` — a row selected from `adminListProviderCatalogEvents` (§4.4, called with the tournament's own `startDate`/`endDate` window and its `sportLeagueId`, per §6.3's picker — no separate candidates endpoint exists). Sets `providerId`/`externalId`/`syncScope=SCORES_ONLY` (§4.4). `409 EXTERNAL_EVENT_ALREADY_LINKED` if another `SportEvent` already holds that identity. |
| `DELETE /sports/golf/tournaments/:eventId/score-source` | `adminUnlinkGolfTournamentScoreSource` | Reverts to the `manual-admin` placeholder identity and `syncScope=NONE`. Already-synced score rows are left as-is. |

**Field**

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/tournaments/:eventId/field` | `adminGetGolfTournamentField` | Field rows with participant identity, `isActive`/`inactiveReason` (§4.1), world rank, odds, seed, tier assignment, and `isLeagueRosterMember: boolean` (derived: is this golfer currently affiliated (`ParticipantLeagueAffiliation`) with the tournament's linked league) — how the UI flags an out-of-roster invite (§6.3). |
| `POST /sports/golf/tournaments/:eventId/field/seed` | `adminSeedGolfTournamentField` | Seeds from the tournament's **league roster** (every golf tournament has a league via its season, required at creation — §4.3) and runs the §4.7 derivation. Creates a `SportEventParticipant` per active affiliated `Participant`; idempotent (skips existing); returns `{ added, skipped, total, seedNumbersDerived, oddsDerived }`. Still checks `seasonId` is present and returns `409 TOURNAMENT_HAS_NO_SEASON` defensively — should be unreachable given `seasonId` is required and immutable, kept as a guard rather than trusted as a real code path. |
| `POST /sports/golf/tournaments/:eventId/field/bulk-add` | `adminBulkAddGolfFieldEntries` | Body `{ participantIds: string[] }` — one call for both the League-browse grid's multi-select and the free-text single-golfer search (§6.3), so there is exactly one add path, not two. Accepts golfers from **any** league's roster, not just the tournament's own league — this is the deliberate path for a cross-league invite (a LIV golfer added to a PGA event, etc., §4.2). No referential check against `ParticipantLeagueAffiliation` exists to bypass. Idempotent: skips any `participantId` already in the field. Returns `{ added, skipped, total }`, matching `adminSeedGolfTournamentField`'s shape. |
| `PATCH /sports/golf/tournaments/:eventId/field` | `adminUpdateGolfFieldEntries` | **Bulk row patch**: `{ entries: [{ sportEventParticipantId, isActive?, inactiveReason?, worldRanking?, oddsToWin?, seedNumber?, price? }] }` (§4.1). One request per Save on the grid. `price` writes `SportEventParticipantGolfValuation.price` with `priceAssignedSource = MANUAL` (§4.5). |
| `DELETE /sports/golf/tournaments/:eventId/field/:sportEventParticipantId` | `adminRemoveGolfFieldEntry` | `409 FIELD_ENTRY_HAS_PICKS` when a `ContestEntryPick` references it — withdraw instead. |
| `POST /sports/golf/tournaments/:eventId/field/refresh` | `adminRefreshGolfTournamentField` | Thin wrapper: resolves the tournament's `externalId` and submits `providerService.syncEventData({ sport: 'GOLF', eventId: externalId, feeds: ['EVENTPARTICIPANTS'] }, ...)` (§4.4a) — a real, ledger-tracked manual sync, not a bespoke persistence call. Returns the submitted `syncRuns` (async; poll/invalidate on completion). `409 EVENT_NOT_LINKED` when `syncScope === 'NONE'`. |

**Tiers and price** (one shared valuation record per field participant, §4.5)

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/tournaments/:eventId/tiers` | `adminGetGolfTournamentTiers` | Tier definitions + ordered assignments + unassigned golfers. Each row includes `price` alongside `tier` — one response, both valuations. |
| `PUT /sports/golf/tournaments/:eventId/tiers` | `adminReplaceGolfTournamentTiers` | Full replace of tier definitions (`tierKey`, `label`, `tierNumber`, `defaultPickCount`). Rejects a change that would orphan assignments unless `reassignOrphansTo` is supplied. |
| `POST /sports/golf/tournaments/:eventId/tiers/auto-assign` | `adminAutoAssignGolfTiers` | Body `{ source: 'ODDS' \| 'WORLD_RANK', tierSize? }` — `tierSize` defaults to 10 (§4.5a). Partitions the field across however many `SportEventGolfTier` rows currently exist, `tierSize` golfers per tier except the last (absorbs the remainder). Reuses the ranking comparator lifted out of `compareTierCandidates`. Writes `tierAssignedSource`, leaves `price` untouched. |
| `PUT /sports/golf/tournaments/:eventId/tiers/assignments` | `adminReplaceGolfTierAssignments` | **The drag-and-drop save.** Full desired state: `{ assignments: [{ sportEventParticipantId, tierKey, tierOrderIndex }] }`, applied in one transaction, `tierAssignedSource = MANUAL`. Idempotent and order-complete, so a dropped request never leaves a half-moved field. |
| `POST /sports/golf/tournaments/:eventId/prices/auto-assign` | `adminAutoAssignGolfPrices` | Body `{ minPrice, maxPrice }`. Same tie-broken position ordering as tiers and odds (§4.7), rescaled into the given price range — higher rank, higher price. Writes `price`/`priceAssignedSource = AUTO_ODDS \| AUTO_WORLD_RANK` (matching whatever ordering the field was seeded with), leaves tier assignments untouched. |

Manual price correction reuses the existing `adminUpdateGolfFieldEntries` bulk field-patch
(§5.2 Field, above), not a separate endpoint — one more optional column in the same grid Save.

**Scores**

| Method + path | operationId | Notes |
|---|---|---|
| `GET /sports/golf/tournaments/:eventId/rounds/:round/scores` | `adminGetGolfRoundScores` | Current round rows + standings for the correction grid. |
| `POST /sports/golf/tournaments/:eventId/rounds/:round/scores/preview` | `adminPreviewGolfRoundScores` | **Dry run.** Same body as apply; returns per-row `resolution` (`MATCHED`\|`UNRESOLVED`\|`AMBIGUOUS`), `change` (`CREATE`\|`UPDATE`\|`UNCHANGED`), the before/after values, and a rollup. Writes nothing. |
| `POST /sports/golf/tournaments/:eventId/rounds/:round/scores` | `adminApplyGolfRoundScores` | Applies via `golf-score-service`, refreshing standings and publishing `live_score.persisted` exactly as the ingestion path does. `422` when any row is unresolved (all-or-nothing). |
| `PATCH /sports/golf/tournaments/:eventId/rounds/:round/scores/:sportEventParticipantId` | `adminUpdateGolfRoundScore` | Single-cell correction. |

Shared bulk body — **JSON on the wire, always**:

```ts
export const AdminGolfRoundScoreRowSchema = z.object({
  participantId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  strokes: z.number().int(),
  thru: z.number().int().min(0).max(18).optional(),
  status: GolfRoundStatusDtoSchema,        // IN_PROGRESS | COMPLETED | DNF | DSQ | MISSED_CUT
}).describe('One golfer\'s result for a single round. Exactly one identifier must be supplied.');

export const AdminGolfRoundScoreUploadSchema = z.object({
  rows: z.array(AdminGolfRoundScoreRowSchema).min(1).max(500),
});
```

CSV and file parsing happen **in the browser** — the client reads the file with `FileReader`,
parses to these typed rows, and posts JSON. That keeps the contract strongly typed, avoids
adding a multipart plugin, and lets the preview endpoint validate one shape instead of three.
`scoreToPar` is derived server-side from `strokes - parForRound`, never uploaded.

**One resolver, both consumers.** The sync path (`persistGolfRounds`, now living inside
`golf-score-service.ts`, §3.1) and this admin upload path currently resolve a score row to a
`SportEventParticipant` two different ways: sync goes exclusively through
`ParticipantProviderMapping`, the admin path tries `participantId` → `externalId` → exact
`playerName`. That's the same problem this plan keeps finding and fixing elsewhere — two
callers, two implementations, free to drift. Both go through one function,
`resolveGolfFieldParticipant(row, { sportEventId, providerId? })`, exported from
`golf-score-service.ts`:

1. `participantId`, if given — direct.
2. `externalId`, if given — resolved via `ParticipantProviderMapping(providerId, externalId)`
   when a `providerId` is in context (always true for the sync caller, since a linked
   tournament's provider is known; usually absent for an admin CSV row), else against the
   bare `Participant.externalId` field (an admin-tracked identifier, unrelated to any specific
   provider's mapping table — a different `externalId` concept from the mapping table's).
3. Exact `playerName` match within *this tournament's* current field — ambiguous if more than
   one matches, unresolved if none do.

The sync caller adapts `GolfRoundUpdate.participantExternalId` into this same `{ externalId,
providerId }` shape before calling; the admin caller passes whichever of the three fields the
uploaded row actually has. The precedence, the ambiguity rule, and the event-scoping are one
piece of code either way — extending the sync path with the name-fallback (step 3) it never
had is what actually closes the linking-without-a-mapping gap, not a second parallel resolver
bolted onto the sync side.

**Golf players (master roster)**

Manual mode has no sync to populate `Participant`, so the roster needs its own surface.
`ParticipantService` already exposes `findBySport`, `search`, `create`, `update` — these
routes are thin wrappers, no new service.

| Method + path | operationId |
|---|---|
| `GET /sports/golf/players` | `adminListGolfPlayers` |
| `POST /sports/golf/players` | `adminCreateGolfPlayer` |
| `GET /sports/golf/players/:participantId` | `adminGetGolfPlayer` |
| `PATCH /sports/golf/players/:participantId` | `adminUpdateGolfPlayer` |

### 5.3 Adjusted existing operations

- `ContestConfigurationRequestSchema` (`packages/shared/dto/`) **loses** `tierConfig` and
  `GolfTieredContestConfig.tiers` — a contest never defines its own tier or price data (§4.6),
  so there's nothing for the request body to carry there anymore. `ContestManagementResponseSchema`
  echoes the event's resolved tiers (and price, where relevant) read-only, so the commissioner
  UI can show what the contest inherited without a mode flag to branch on.
- `AdminEventSummaryDtoSchema` (`admin.dto.ts:156`) gains `syncScope` so the existing
  `/manage/events` browser can label rows (`Manual` / `Scores synced` / `Fully synced`),
  reusing the new column rather than re-deriving a parallel classification from `providerId`.
- `EventStatusDtoSchema` rewritten to derive from the new domain constant (same six values,
  so the wire contract is unchanged).

---

## 6. UI

### 6.1 Navigation

`clients/poolmaster/src/features/root-admin/manage-navigation.ts` is the declarative menu.
Extend it with a group axis rather than a flat list:

```ts
export type ManageSectionGroup = 'platform' | 'sports' | 'operations';
export type ManageSectionKey = /* existing */ | 'golf';

export const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  { key: 'leagues', group: 'platform', ... },
  { key: 'teams',   group: 'platform', ... },
  { key: 'users',   group: 'platform', ... },
  { key: 'golf',    group: 'sports', title: 'Golf',
    description: 'Create and run golf tournaments: field, tiers, workflow, and scores.',
    to: '/manage/golf' },
  { key: 'content-configuration', group: 'operations', ... },
  { key: 'events',       group: 'operations', ... },
  { key: 'sync',         group: 'operations', ... },
  { key: 'sync-config',  group: 'operations', ... },
];
```

`root-admin-manage-hub-page.tsx` groups tiles by `group` under a heading per group.
Basketball later is one more row with `group: 'sports'` and one route subtree — no reshuffle.

`getManageBreadcrumbLabel` needs cases for `golf`, `tours`, `seasons`, `tournaments`,
`players`, `field`, `tiers`, `scores`, and `new`; `:eventId` / `:participantId` segments
resolve to the entity name from the loaded query (the layout currently only does static
labels — extend it to accept an optional label override from the child route via context).

### 6.2 Routes

Added to the `/manage` children array in `clients/poolmaster/src/routes/index.tsx`, inside
the existing `RootAdminRouteGuard` + `RootAdminManageLayout`:

```
/manage/golf                                     RootAdminGolfHubPage
/manage/golf/leagues                               RootAdminGolfLeagueListPage
/manage/golf/leagues/:leagueId                     RootAdminGolfLeagueHomePage
/manage/golf/seasons                             RootAdminGolfSeasonListPage
/manage/golf/seasons/:seasonId                   RootAdminGolfSeasonHomePage
/manage/golf/tournaments                         RootAdminGolfTournamentListPage
/manage/golf/tournaments/new                     RootAdminGolfTournamentCreatePage
/manage/golf/tournaments/:eventId                RootAdminGolfTournamentHomePage
/manage/golf/tournaments/:eventId/field          RootAdminGolfTournamentFieldPage
/manage/golf/tournaments/:eventId/tiers          RootAdminGolfTournamentTiersPage
/manage/golf/tournaments/:eventId/scores         RootAdminGolfTournamentScoresPage
/manage/golf/players                             RootAdminGolfPlayerListPage
/manage/golf/players/:participantId              RootAdminGolfPlayerHomePage
```

This follows the established list → Home pattern: the list page is read-only and links out;
the Home page is canonical and carries the editing affordances. Field / Tiers / Scores are
separate routes rather than tabs because each is a distinct purpose with its own bulk actions
and its own error surface — and each would blow the 400-line page threshold if tabbed together.

### 6.3 Screens

**`/manage/golf` — Golf hub.** `Tile` grid over a local `GOLF_SECTIONS` const (mirrors the
`root-admin-sync-config-page.tsx` sub-hub pattern): Tours, Seasons, Tournaments, Players, and
a pass-through tile to `/manage/sync` prefiltered to golf.

**`/manage/golf/leagues` — Tours list.** `DataGridPage` over `adminListGolfLeagues` — list +
a **New tour** `FormModal` (name + optional match keyword). Columns: Tour (e.g. "PGA Tour") ·
Match keyword · Roster size · Seasons · Active. Rows link to Tour Home — an earlier draft of
this plan had no separate Home page here, reasoning a tour had nothing to manage beyond
name/keyword/active; that's no longer true once the roster moved to the league level (§4.2), so
this screen follows the same list → Home pattern as everything else.

**`/manage/golf/leagues/:leagueId` — Tour Home.** Header: name/match-keyword inline edit
(`FormModal`), active toggle, and a **Seasons** count linking to
`/manage/golf/seasons?sportLeagueId=<id>` (the Season list pre-filtered to this tour). Below
that: the roster `DataGrid` (golfer · world rank · status) — the screen the user maintains
week-to-week as world rankings move, since ranking lives on the roster now, not on any one
season (§4.2). **Same bulk paste / upload / preview / apply pattern** as the round-scores
screen described later in this section — same shared parser and `FileInput` component, a
different row shape (`externalId or playerName, worldRanking`) — plus per-row inline edit and
an **Add golfer** picker (`adminAddGolfLeagueRosterEntry`), and a row-level **Remove** action
(`adminRemoveGolfLeagueRosterEntry`, a `ConfirmationModal` distinguishing "remove from this
tour" from "retire" — the latter is the Player Home's own status edit, §4.1/§4.2, not this
screen's job).

**`/manage/golf/seasons` — Season list.** `DataGridPage` over `adminListGolfSeasons`, with a
Tour `Select` filter at the top (backed by `adminListGolfLeagues`) — reading `?sportLeagueId=` from
the URL when arriving from the Tours screen. Columns: Season (e.g. "PGA Tour 2026") · Tour ·
Year · **Current** (a `StatusBadge` on the row whose `isCurrent` is true) · Tournament count.
Rows link to Season Home. Header action: **New season** (its form's Tour `Select` defaults to
the current filter, if any) — pre-creating a 2028 season well ahead of time is a normal,
expected use of this screen (§4.2), not an edge case.

**`/manage/golf/seasons/:seasonId` — Season Home.** No roster here anymore — this is purely
the tournament-calendar view for one year of a league (§4.2). Header shows the season's tour
and, when applicable, a **Set as current season** action (`ConfirmationModal` — it atomically
moves the tour's current designation here, §5.2) or a **Current season** badge when it already
is one, plus a **New tournament** action navigating to `/manage/golf/tournaments/new?seasonId=<id>`
— the actual admin path into tournament creation (League → its season → new tournament, §4.4a),
not only the flat `/manage/golf/tournaments` list's own header action. A **Clone to next year**
action (§4.2a) opens a `ConfirmationModal` showing the count this page already has loaded from
`adminGetGolfSeason` — "6 tournaments will be copied to PGA Tour 2027, dates shifted one year
forward" — no separate preview call needed, since a clone's target count is always exactly the
source season's own tournament count, unlike a CSV upload's per-row resolution. Confirming
calls `adminCloneGolfSeason` directly; on success, navigates to the new season's Home. Below
that: a `DataGrid` of this season's own tournaments (name · venue · starts · status · readiness
— the same tone helpers as the Tournament list, below), linking each to its own Tournament
Home.

**`/manage/golf/tournaments` — Tournament list.** `DataGridPage` over
`adminListGolfTournaments`. Columns: Tournament (name + venue) · Sync badge (**Manual** /
**Scores synced** / **Fully synced**, from `syncScope`) · Starts · Status · Readiness
(+ reasons, reusing the tone helpers already in `root-admin-events-page.tsx` — lift
`eventStatusTone` / `readinessTone` / `formatReadiness` into a shared `golf-admin-utils.ts`
rather than copying them) · Field count · Tiers · Contests. Rows link to Tournament Home.
Header action: **New tournament**.

**`/manage/golf/tournaments/new` — Create.** React Hook Form page (8 fields, well past the
two-field threshold). `DateTimeField` for start / end / release / field-lock. A **required**
Season `Select` (defaults to the tour's **current season** — `SportLeague.currentSeasonId`,
§4.2 — when the tournament's tour is already known/selected first, otherwise the most
recently created active season; must be explicitly confirmed regardless — every tournament
has one, §4.3) — if no golf season exists yet at all, the
page shows a blocking `Callout` ("Create a season before creating a tournament") linking to
`/manage/golf/seasons` instead of a broken empty `Select`. A "Derive timing from policy"
helper prefills `releaseAt` / `fieldLocksAt` from the matching `ContestTimingPolicy` rule,
editable afterward. Submit → navigate to Tournament Home. The Season field is not editable on
the tournament afterward (§4.3) — the Tournament Home summary (below) shows it read-only.

A **segmented header, "Build manually" / "Browse provider events"**, switches this page
between the form above and the second entry point (§4.4a): a date-range-and-league filtered
list from `adminListProviderCatalogEvents` — pre-scoped to this season's tour when arriving
from Season Home (§4.4a), open when arriving from the flat tournament list — each row a
**Select** button. Selecting one collapses the form to just Season (still required, still
pre-filled when arriving scoped) and `rounds` (still admin-set, defaulting to 4 — the provider
contract has no round count to read, §4.4a) — name/venue/dates come from the selected event, not
retyped — and submits to `adminCreateGolfTournamentFromProviderEvent` instead of
`adminCreateGolfTournament`. Submit → navigate to Tournament Home with an empty field and a
prominent **Load Participant Field** prompt (§4.4a's Step 2, a separate click, not part of this
submit).

**`/manage/golf/tournaments/:eventId` — Tournament Home.** The canonical page. Four blocks:

1. **Summary** — `DefinitionList` of name / venue / dates / rounds / par, with an inline
   **Edit details** `FormModal`. Read-only with an explanatory `Alert` when `syncScope === 'FULL'`
   (fully provider-owned).
2. **Workflow rail** — a horizontal `ProgressIndicator` of the lifecycle
   (`Setup → Field open → Field locked → Live → Completed`) with the current stage
   marked, followed by the allowed next transitions as buttons and any blocking reasons as
   a `Callout`. Every transition is a `ConfirmationModal` — these are hard to reverse and
   fire contest activation / settlement downstream. Backed by the `workflow` block on
   `adminGetGolfTournament`, so the allowed set is server-computed from the transition map,
   never re-derived in the client. When `autoLifecycleEnabled` (§4.10, default on), a small
   note under the rail states the next automatic transition and when it'll fire ("Will go
   live automatically on Mar 12, 8:00 AM, from Round 1's schedule") — the manual buttons stay
   available regardless, an admin can always move faster than the schedule. A **Manage
   lifecycle manually** toggle turns this off per tournament (weather delays, disputes) —
   `ConfirmationModal`, since it's the one flag the background scheduler (§3.6) checks before
   ever touching this tournament. A companion **Rounds** `ListCard` (round number · scheduled
   date · scheduled end) with inline date editing is where a delay actually gets recorded —
   editing Round 3's date doesn't require disabling auto-lifecycle first, it just changes what
   the scheduler is comparing against.
3. **Score source** — shows the current link status: *Not linked — scores must be entered
   manually* (`syncScope = NONE`), or *Linked to `<provider>` event `<name>` — polling every
   `<eventLiveScores.intervalSeconds>`s* (`syncScope = SCORES_ONLY`/`FULL`). **Link to provider
   event** opens a `PickerModal` listing `adminListProviderCatalogEvents` (§5.2) filtered to
   the tournament's own sport/league and a date window around its `startDate` — a plain,
   unscored list, radio-selectable, with no "suggested match" or ranking. The admin reads the
   list and picks the right one; there is no candidate-count branching to design for. This is
   deliberately simple — see §4.4 for why an earlier scored auto-match design was dropped.

   Either path ends in a `ConfirmationModal` calling `adminLinkGolfTournamentScoreSource` —
   this changes where scores come from, so it's always an explicit confirm, never silent.
   **Unlink** reverts to manual (also a `ConfirmationModal`). Hidden when `syncScope === 'FULL'`
   — a fully provider-owned event's score source isn't admin-editable.
4. **Sections** — `ListCard`s to Field / Tiers / Scores, each showing its readiness
   ("144 golfers, 6 withdrawn", "4 tiers, 12 unassigned", "Round 2 of 4 loaded").

**`/manage/golf/tournaments/:eventId/field` — Field editor.** `DataGrid` with per-row draft
editing: Player (+ a small **Guest** `StatusBadge` when `isLeagueRosterMember === false` —
this golfer isn't affiliated with the tournament's league, e.g. a cross-league sponsor
exemption, §4.2) · Active (`Switch`, with an inline **Reason** `Select` — WITHDRAWN / CUT /
ELIMINATED — that appears only once toggled off, §4.1) · World rank · Odds · Seed · Price
(editable here too — same column as the Tier editor's inline price edit, §4.5) · Tier (read-only, links to
Tiers). Draft state is seeded once per `eventId` and reset explicitly — per
`rules/react-ui-rules.md` "Server Data Form-State Hazard", never re-seeded on query object
identity change. A sticky action bar shows the dirty-row count with **Save changes** (one
`adminUpdateGolfFieldEntries` call) and **Discard**. Header actions: **Seed field from league
roster** (`ConfirmationModal` previewing how many golfers will be added and that
`seedNumber`/`oddsToWin` will be derived per §4.7 — always available, since every tournament
has a league via its season, §4.3) and
**Add More Participants** (`PickerModal`, replacing an earlier single-golfer-only design):
a **League** `Select` at the top — defaulting to *unselected*, since the tournament's own
league roster is already seeded by default (§4.2/§4.7) and this action exists for the
exception case — populated from `adminListGolfLeagues`. Choosing a league loads *that*
league's **current roster** (the same `ParticipantLeagueAffiliation` data the League Home
roster grid reads, §6.3) into a `SelectableDataGrid`: Player · World rank, each row checkbox-selectable,
plus a header **Select all** checkbox, excluding golfers already in this tournament's field.
This is the guided version of the LIV-golfer-into-a-PGA-event case (§4.2) — browse the other
league's actual roster instead of needing to already know a name to free-text search for. A
free-text name search across **all** `Participant`s (not season-roster-scoped) remains available
below the grid for the rarer case of a golfer who isn't on any league's current roster at all —
checking a search result adds it to the same selection set as the grid, so there is exactly one
**Add selected (N)** submit action regardless of how a golfer was found. Submitting calls
**`adminBulkAddGolfFieldEntries`** (§5.2) with every selected `participantId` in one request —
idempotent, skips anyone already in the field, matching
`adminSeedGolfTournamentField`'s existing `{ added, skipped, total }` response shape for
consistency. A third header action appears only when `syncScope !== 'NONE'`,
labeled **Load Participant Field** while this tournament's field is empty and **Refresh
Participant Field** once it isn't (one action, one endpoint, a client-computed label — §4.4a) —
calls `adminRefreshGolfTournamentField`. The first, empty-field click runs with no confirmation
(nothing to overwrite); every click after that goes behind a `ConfirmationModal` warning it can
overwrite manually-adjusted rank/odds for any golfer the provider still reports.

**`/manage/golf/tournaments/:eventId/tiers` — Tier editor.** Two-column
`SplitContentLayout`: tier definitions on the left (add / rename / reorder / set pick count,
with a `ConfirmationModal` on delete showing orphan count), tier columns with ordered golfer
cards on the right, plus an "Unassigned" column. Each golfer card also shows **Price** (from
the same shared valuation record, §4.5) with inline edit — tier and price live on one screen
because they're the same underlying concept for two draft formats, not because one depends on
the other.

- **Drag and drop needs a new dependency.** No DnD library exists in `clients/poolmaster`
  and ordering is done today with numeric `sortOrder` inputs. Recommend `@dnd-kit/core` +
  `@dnd-kit/sortable` — it is the only mainstream option with first-class keyboard
  sensors, which `rules/react-ui-rules.md` §8 requires. Native HTML5 drag events are not
  keyboard accessible and would fail that rule. This triggers a Perry review pass.
- **Every drag has a keyboard and pointer-free equivalent**: each card carries a "Move to
  tier" `Select` and up/down buttons. Drag is an accelerator, never the only path.
- Header actions: **Auto-assign tiers from odds** / **from world rank** (`ConfirmationModal`,
  warns that manual tier assignments will be replaced), **Auto-assign prices**
  (`ConfirmationModal` for a `minPrice`/`maxPrice` range, warns that manual prices will be
  replaced — independent of the tier action, §4.7a), and **Save** posting the complete desired
  tier state via `adminReplaceGolfTierAssignments` (price edits save individually, via the
  same field bulk-patch as any other field column).

**`/manage/golf/tournaments/:eventId/scores` — Round scores.** An `Alert` at the top when
`syncScope !== 'NONE'`: *"Scores for this tournament are synced automatically from `<provider>`
every `<N>` seconds. Manual edits here are corrections and may be overwritten by the next sync
tick"* — the manual bulk-load/correction tools below remain fully usable, this is a heads-up,
not a lock, per the open question in §9 about how manual edits interact with the next tick.
Round selector (`SegmentedControl`, 1..`rounds`, each option labeled with its
`SportEventRound.scheduledDate`, e.g. "Round 2 — Mar 13" — the join this plan's FK change
(§4.10) makes free), then two stacked sections:

1. **Bulk load** — format `SegmentedControl` (CSV / JSON), a `Textarea` for paste, a new
   shared `FileInput` for upload (both feed the same parser), and a **Download CSV template**
   button emitting the documented header
   `externalId,playerName,strokes,thru,status` prefilled with the current field.
   **Preview** posts to the preview endpoint and renders a result `DataGrid`:
   resolution badge · player · before → after · change type, with unresolved rows called out
   in an `Alert`. **Apply** is disabled until every row resolves.
2. **Corrections** — a `DataGrid` of the round's current rows with inline strokes/thru/status
   editing for one-off fixes, saving per row via `adminUpdateGolfRoundScore`.

**`/manage/golf/players` and `/:participantId`.** `DataGridPage` (Name · Short name ·
Nationality · Status · Provider mappings count) plus a Player Home with an edit form and a
read-only provider-mapping list. Header action: **Add player**.

**Commissioner-side change.** `ContestConfiguration` editing shows the tournament's tiers (and
price, if the contest format uses it) **read-only** — no mode toggle, since there's no longer
a custom-per-contest option to choose (§4.6). This is the only change outside `/manage`, and
it's a subtraction from what the commissioner UI would otherwise have needed to build (a
tier-editing form), not an addition.

### 6.4 Frontend supporting work

- `src/lib/query-keys.ts` — add a `QueryKeys.rootAdmin.golf.*` namespace
  (`tours`, `leagueRoster(sportLeagueId)`, `seasons(sportLeagueId?)`, `season(id)`, `tournaments`,
  `tournament(id)`, `field(id)`, `tiers(id)`, `roundScores(id, round)`, `players`,
  `player(id)`) plus
  `QueryKeys.rootAdmin.providerCatalogEvents(providerId, sport, search)` for the score-source
  picker. Inline key arrays are blocked by `rules:check:no-inline-query-keys`.
- The score-source **Link to provider event** picker reuses the same `PickerModal` primitive
  already used for **Add golfer** — a search box over `adminListProviderCatalogEvents`, not a
  new modal type.
- The bulk-upload paste/upload/preview/apply UI (CSV or JSON, preview grid, unresolved-row
  handling) is identical shape for round scores and league-roster uploads — build it once as
  a shared `BulkUploadPanel` in `src/features/shared/ui/` parameterized by row schema, parser,
  and preview/apply mutations, rather than duplicating it per screen.
- `src/test/msw-api.ts` — every new operationId must be added to `operationDefinitions` or
  its tests fail with "Unhandled PoolMaster API request in test".
- New shared primitives in `src/features/shared/ui/`: `FileInput` (bare `<input type="file">`
  is barred in feature code by the shared-UI control rule); `SortableList` wrapping
  `@dnd-kit` with the built-in keyboard fallback; `SelectableDataGrid` wrapping `DataGrid` with
  a checkbox column + header "select all," for the Add More Participants grid (§6.3) — verified
  no row-selection capability exists on today's `DataGrid` (`data-grid.tsx`), so this is new,
  not an extension of an existing prop.
- Shared helper `src/features/root-admin/golf-admin-utils.ts`: status/readiness tone +
  label helpers lifted from `root-admin-events-page.tsx`, the CSV/JSON round-score parser,
  and score formatting. All pure and separately unit-tested, matching
  `root-admin-sync-utils.ts`.
- Use `extractErrorMessage` from `src/lib/errors.ts` — not the local near-duplicates in
  `root-admin-sync-config-utils.ts` / `root-admin-user-account-page.tsx`.
- All mutations go through `useInvalidatingMutation` with explicit `invalidates`.
- `data-testid` on every page root (`root-admin-golf-*-page`) and every action.

---

## 7. Slice sequence

Each slice is one PR through the multi-pass review flow. Dom gates slices 1–6 (each
introduces new tables/columns) before Brad implements; Perry is required on slice 11 (new
dependency) and Felix on every frontend slice.

| # | Slice | Depends on |
|---|---|---|
| 1 | Shared `SportEventStatus` enum (5 values, `OFFICIAL` dropped) + `SportEventParticipant.isActive`/`inactiveReason` (replacing the 7-value participant status enum, §4.1) + Prisma migration + bare-literal sweep *(folds `pool-master-5xi.1`)*; also updates `loadGolfLeaderboardParticipants`/`GolfLeaderboardParticipantRow` (`contests/service.ts`, `contests.mapper.ts`) off the dropped `status` column, per `plans/126` §4.1/§9 item 5 — that plan's fix rides here, not as its own follow-up slice | — |
| 2 | Extract `event-lifecycle-service.ts`; `IngestionPersistence` calls it; transition map + exhaustiveness test | 1 |
| 3 | Tier + valuation tables (`SportEventGolfTier`, `SportEventParticipantGolfValuation`); `modules/golf/golf-tier-service.ts` incl. `ensureDefaultGolfTiers` (6×10 default, §4.5a), `getEffectiveTiersForContest`, and the auto-assign partition algorithm; delete `derivePersistedTierConfig`, `tier-engine.ts`, `pricing-engine.ts`. **Does not yet drop `SportEventParticipantValuation`** — `drafts/routes.ts` still reads it (§4.6b); that table drop is sequenced into slice 9 instead, after its reader is rewired | 1 |
| 4 | `SportLeague` + Season + `ParticipantLeagueAffiliation` tables + `SportEvent.seasonId`; `modules/sport-catalog/` (§3.2 — sport-league/season/league-roster services, cross-sport); `modules/golf/golf-seeding-algorithm.ts`; golf league/season/roster admin routes (thin wrappers) | 1 |
| 5 | `SportEvent.syncScope` enum + migration; `scheduled-event-reader.ts` per-feed gating; manual sync-trigger guard; `MANUAL_ADMIN_PROVIDER_ID` placeholder identity; regression tests proving `NONE` never syncs and `SCORES_ONLY` syncs only live-scores/results (§4.4) | 1 |
| 6 | `SportEventRound` table + `SportEvent.autoLifecycleEnabled` + `SportEventParticipantGolfRound` FK migration; `ensureSportEventRounds` helper + `persistGolfRounds` update (§4.10); `modules/events/event-lifecycle-scheduler.ts` (§3.6); round-schedule admin routes | 1 |
| 7 | `LeagueEvent` table (§4.3a); admin golf routes: tournaments CRUD + transitions, calling `ensureSportEventRounds` (§4.10), `ensureDefaultGolfTiers` (§4.5a), and the `LeagueEvent` find-or-create by `(sportLeagueId, name)` at creation (`modules/admin/golf/`, swagger retag, `admin-golf.dto.ts`) | 2, 3, 5, 6 |
| 8 | `golf-field-service.ts` + field routes (seed-from-league-roster with derivation / bulk-add / bulk patch / remove) | 4, 7 |
| 9 | Tier + price routes (definitions, auto-assign tiers, auto-assign prices, assignments — one shared `SportEventParticipantGolfValuation` table, §4.5); drop legacy `tierMode`/`configJson.tiers`; **rewire `drafts/routes.ts`'s `deriveTierConfig` and every price-reading call site to call `golf-tier-service.getEffectiveTiersForContest` instead of reading `SportEventParticipant.valuations`/`contestConfiguration.tierConfig` directly, THEN drop the now-actually-unread `SportEventParticipantValuation` table (§4.6b — sequencing matters, this order, not the reverse)**; drop `cutRule`/`playoffHandling`/`displayScoring`/`tiebreaker` from `GolfTieredContestConfig` + their DTOs + `buildParticipantScoringConfig`'s write of them (§4.6a); migration seeding the two tiered `ContestConfigTemplate` presets (§4.6c) | 3, 7 |
| 10 | Extract `golf-score-service.ts` out of `score-publisher.ts` (now resolving `roundNumber → SportEventRound.id`, §4.10); score preview + apply + single-row routes | 6, 7 |
| 11 | Golf player roster routes; `@dnd-kit` + `FileInput` + `SortableList` + `SelectableDataGrid` + shared `BulkUploadPanel` primitives | 7 |
| 12 | `adminListProviderCatalogEvents` (sync lane); `event-score-source-service.ts` — plain candidate-list + link/unlink routes (§4.4, §5.2) | 4, 5, 7 |
| 13 | `event-score-source-service.getProviderEventDetail` (§3.4 — centralizes the last direct provider-registry lookup for admin-golf); extract `golf-field-service.seedFieldFromProvider` from `IngestionPersistence.persistParticipantsWithDiagnostics`; repoint `runEventFieldSync` (`EVENTPARTICIPANTS`) to call it instead of `persistEventDetailWithDiagnostics`, fixing the status-overwrite/contest-side-effect risk (§4.10); `deriveGolfTournamentRounds` in `golf-seeding-algorithm.ts`; `adminCreateGolfTournamentFromProviderEvent` route (calls `getProviderEventDetail`) + `adminRefreshGolfTournamentField` route (thin wrapper over `providerService.syncEventData`, §4.4a) | 7, 8, 12 |
| 14 | Frontend: manage-navigation groups, golf hub, tournament list + create (season select + "Build manually"/"Browse provider events" mode, §4.4a) + Home (workflow rail + auto-lifecycle hint + Rounds card + score-source block) | 6, 7, 11, 12, 13 |
| 15 | Frontend: Tours list + Tour Home roster editor (bulk upload) + Season list (tour-filtered) + Season Home (tournament calendar, no roster) | 4, 11, 14 |
| 16 | Frontend: Field editor (seed-from-league-roster action + Add More Participants league-browse grid + Load/Refresh Participant Field action, §4.4a) | 8, 11, 13, 14 |
| 17 | Frontend: Tier editor with drag-and-drop | 9, 14 |
| 18 | Frontend: Round scores (bulk paste / upload / preview / corrections + sync-tick alert) | 10, 14 |
| 19 | Frontend: Golf players list + Home | 11, 14 |
| 20 | Commissioner contest-config: read-only inherited tier/price display (no mode toggle); remove `cutRule`/`playoffHandling`/`displayScoring`/`tiebreaker` form fields from `create-contest-page.tsx`/`contest-entry-page.tsx`/root-admin content-configuration pages and the email-template display (§4.6a); remove `create-contest-page.tsx`'s dead `GOLF_CATEGORY_PICKS` branch entirely (`ContestMode` state, category pickers, its submit path, §4.11) | 3, 9 |
| 21 | FAPI end-to-end scenario (manual setup + provider-linked live scoring + algorithmic lifecycle transition) + Playwright smoke additions | 14–19 |
| 22 | Unrelated cleanup (§4.11): drop `PrismaSport` enum, `ContestSportEvent` table, `GolfContestConfigMode.GOLF_CATEGORY_PICKS` + `GolfCategoryContestConfig` + their DTOs/generated-client references, `espn-adapter.ts` + `openf1-adapter.ts` + their `providerFactories` entries | — |
| 23 | `season-service.cloneSeasonTournaments`; `adminCloneGolfSeason` route reusing `adminCreateGolfTournament`'s internal creation function per source-season tournament (§4.2a); Frontend: **Clone to next year** action on Season Home with a count-preview `ConfirmationModal` | 4, 7, 15 |

---

## 8. Verification

**Testing policy reminder — see the header for the full statement.** The lists below are
gates to run, not the whole obligation: every slice also updates the existing tests it
touches, adds direct unit coverage for its new code and branches, and keeps FAPI coverage
in sync with any API shape it changes. A slice that only makes the checks below pass
without doing that is not finished.

**Local gates (all required before each commit, per `rules/testing-rules.md` §3):**

```
npm run rules:check
npm run api:check
npx turbo typecheck --force
npx eslint 'packages/*/src/**/*.ts' 'clients/*/src/**/*.{ts,tsx}' --max-warnings 0
npx jest --config tests/jest.config.js --forceExit
npm run test:service:functional-api
npm run test:poolmaster:unit
```

After any DTO or route change: `npm run api:refresh && npm run api:validate`.

**Backend tests**

- *Unit* — transition-map validity and rejection; tier auto-assign ordering for ODDS and
  WORLD_RANK including null-value ties; price auto-assign (§4.7a) — the best-`seedNumber`
  golfer lands at `maxPrice`, the worst at `minPrice`, mid-field interpolated by relative
  weight, independent of whatever the tier auto-assign action did (running one never touches
  the other's `*AssignedSource`); CSV/JSON row resolution precedence
  (`participantId` > `externalId` > exact `playerName`) and ambiguity detection; field-seed
  idempotency; `adminSetCurrentGolfSeason` atomically moving `currentSeasonId` in one write —
  no window where a league has zero or two current seasons, and setting season B current after
  A correctly clears A's "current" status without a separate unset call;
  `scheduled-event-reader.ts`'s per-feed `toFeedWhere` honors `syncScope` for
  every combination (`NONE`/`SCORES_ONLY`/`FULL` × each feed type, §4.4);
  `event-score-source-service.listCandidateEvents` — returns the plain, unscored list of
  provider catalog events within the tournament's date window and league, with no ranking
  or filtering beyond that window; zero candidates in the window returns an empty list, not
  an error; `event-lifecycle-scheduler.ts`'s
  due-transition check — a tournament whose Round 1 `scheduledDate` (or fallback `startDate`
  when no rounds are populated) has passed is due for `IN_PROGRESS`; one whose last round's
  `scheduledEndAt` (or fallback `endDate`) has passed is due for `COMPLETED`; a tournament with
  `autoLifecycleEnabled = false` is never due regardless of dates; a `syncScope = 'FULL'`
  tournament is never due regardless of dates or the flag.
- *Integration* (`tests/integration/core-api/`) — the new tier tables' CRUD and cascade
  behavior; `@unique(sportEventParticipantId)` enforcement on reassignment; the sync-scope
  regression proving `listEventIdsForFeed` never returns a `NONE`-scope event for any feed and
  returns a `SCORES_ONLY`-scope event only for `EVENTLIVESCORES`/`EVENTRESULTS`;
  `adminLinkGolfTournamentScoreSource` rewriting `providerId`/`externalId`/`syncScope` in one
  transaction and `adminUnlinkGolfTournamentScoreSource` reverting them; `409
  EXTERNAL_EVENT_ALREADY_LINKED` when the target provider event is already held by another
  `SportEvent` row; `adminBulkAddGolfFieldEntries` succeeding for a `Participant` who is **not**
  affiliated (`ParticipantLeagueAffiliation`) with the tournament's league (the cross-league
  invite case, §4.2) — proving there is no FK or application-level check blocking it — and
  `adminGetGolfTournamentField`
  correctly reporting `isLeagueRosterMember: false` for that row; a full scheduler-sweep test —
  seed a tournament with Round 1's `scheduledDate` in the past, run one sweep, assert the row's
  `status` is now `IN_PROGRESS` via the identical `applySportEventStatusTransition` call path
  the admin-triggered route uses (not a second write path), and that the resulting audit record
  is distinguishable as `actor.type = 'SYSTEM'`; running the same sweep against a `syncScope =
  'FULL'` event with an equally-overdue date asserts no write occurs at all;
  `adminCreateGolfTournament` creating the expected N `SportEventRound` rows with sequential
  daily dates from `startDate`; a direct `SportEventParticipantGolfRound` insert referencing a
  `sportEventRoundId` that doesn't belong to the same `sportEventId` (or doesn't exist at all)
  failing at the foreign-key/constraint level, not silently succeeding; `persistGolfRounds`
  (the sync path) correctly resolving an incoming bare `round: number` to its
  `SportEventRound.id` via `ensureSportEventRounds`, proving the sync writer and the admin
  writer converge on the same rows rather than diverging; `adminCloneGolfSeason` (§4.2a) —
  clone a season with 3 tournaments, assert the new season's `startDate`/`endDate` landed one
  calendar year forward (including a leap-year source date), assert every cloned tournament has
  an empty field, a fresh 6-tier default set, `syncScope = NONE`, and dates shifted the same
  way, assert `SportLeague.currentSeasonId` is unchanged after cloning, and assert the league's
  roster (`ParticipantLeagueAffiliation`) is untouched by the clone — proving there is nothing
  season-scoped left for it to copy.
- *Contract verification* — a case per new operation in
  `contract-verification-root-admin.integration.ts`. This is a hard gate, not deferrable;
  happy-path assertions required, not error-path only.
- *FAPI* (`tests/functional/golf-admin-tournament.functional.ts`) — the flagship scenario,
  driven through the generated SDK plus one real interaction with the mock provider to prove
  the score-sync path actually works end to end (not just the manual bulk-upload path):
  create a `SportLeague` ("PGA Tour", `matchKeyword: "PGA"`) → create a season linked to it →
  create 20 players → bulk-upload the PGA Tour league roster with world rankings
  (including a tied pair, to exercise the tie-break) → create a tournament linked to that
  season → seed field from league roster and assert `seedNumber`/`oddsToWin` were derived
  correctly (unique seeds, odds ordering matches rank ordering) → withdraw 2 → **create a 21st
  player who is not affiliated with "PGA Tour" (a LIV golfer analogue) and add them to the field
  via `adminBulkAddGolfFieldEntries`, asserting success and `isLeagueRosterMember: false`** →
  manually adjust one golfer's odds → auto-assign 4 tiers (asserting the guest golfer receives
  a tier alongside everyone else — tier assignment doesn't care about roster origin) →
  **auto-assign prices ($1,000–$10,000) and assert `tierAssignedSource` is untouched by it**
  (the two are independent actions on the same row, §4.5) → drag one golfer between tiers →
  transition to
  field-locked → create a league contest against it → submit 2 entries → transition to live →
  **call `adminListProviderCatalogEvents` for the tournament's date window, assert the mock
  provider's scenario event appears in the plain list, and link it**
  (`adminLinkGolfTournamentScoreSource`) → trigger one scheduled live-scores poll tick and
  assert R1 scores arrived via the sync path
  (not the manual-upload endpoint) into `SportEventParticipantGolfStanding` and the contest
  leaderboard → **run an `EVENTPARTICIPANTS` sync sweep and assert the tournament's field is
  untouched** (proving `syncScope = SCORES_ONLY` actually blocks non-score feeds) → bulk-upload
  R2–R4 scores manually (the QA/testing path) → transition to completed → assert
  `ContestEntryGolfStanding` settlement → **unlink** and assert a further poll tick no longer
  touches the tournament. Plus permission negatives asserting `403 ROOT_ADMIN_ACCESS_REQUIRED`
  on every new operation.

**Frontend tests**

- Colocated Vitest + RTL per page with MSW-bound operation mocks: happy path, empty, error,
  and the authority case (`syncScope = FULL` tournament renders read-only).
- Tier editor: assert the **keyboard** reassignment path, not only drag — that is the
  accessible path and the one a test can drive deterministically.
- Scores page: paste a CSV with one unresolved row, assert Apply stays disabled and the
  unresolved row is surfaced; assert the sync-tick `Alert` renders when `syncScope !== 'NONE'`.
- Tournament Home: the Link-to-provider-event picker calls
  `adminLinkGolfTournamentScoreSource` and the score-source block updates from the mutation
  response; Unlink confirms and reverts it.
- Field editor: the "user typed, query refetched" case required by the form-state-hazard rule.
- `clients/poolmaster/e2e/root-admin-navigation-smoke.e2e.ts` — one `goto` + testid
  assertion per new `/manage/golf/*` route.

**Manual walkthrough** — run the app, sign in as root admin, and complete the FAPI scenario
by hand through the UI with the ingestion scheduler running: confirm an **unlinked** (`NONE`)
tournament is never touched by any scheduled sync run (check `/manage/sync` run history), then
confirm a **linked** (`SCORES_ONLY`) tournament's leaderboard updates automatically at the
configured `eventLiveScores.intervalSeconds` cadence while its field/tiers remain unchanged by
any schedule/field/rankings sync sweep.

**Docs riding with the code** — `README.md` endpoint list, the golf module README, and the
CSV upload format contract land in the same PRs.

---

## 9. Open questions

1. ~~**Manual score edits vs. the next sync tick.**~~ **Confirmed.** Once a tournament is
   `SCORES_ONLY`-linked, a manual round-score correction (§6.3) and the next scheduled
   live-scores poll both write to the same `SportEventParticipantGolfRound`/`GolfStanding`
   rows; the scheduled sync always wins on its next tick, with no "protect this row" flag.
   No schema change now — revisit once more is known about which sync feeds actually exist
   per league.
2. **Linking collision with an existing provider-created row.** If schedule/field sync is
   still enabled for golf (transition period) and has already created its own `SportEvent`
   row for the same real tournament, linking an admin-created tournament to that same
   provider event would collide on `@@unique([providerId, externalId])`. Current assumption:
   reject with `409 EXTERNAL_EVENT_ALREADY_LINKED` and let the admin resolve manually (delete
   the stale auto-synced row first) rather than attempt an automatic merge. Confirm, or say if
   an assisted-merge flow is worth building.
3. ~~**Auto-match scoring thresholds and weights.**~~ **Confirmed: deleted.** No candidate
   scoring exists — `event-score-source-service.listCandidateEvents` (§4.4) returns a plain,
   unscored list within the tournament's date window/league, and the admin picks manually.
   There is no threshold or weight to tune because there is no scoring left to tune.
4. **Promoting `SportLeague` to a real provider split.** `SportLeague` (§4.2) models *which tour* as
   data, but the provider registry still maps one provider per top-level `Sport` value
   (`GOLF`), and no second golf provider exists yet. If PoolMaster ever contracts with a
   LIV- or LPGA-specific data provider, that provider needs its own registry entry, which
   likely means promoting golf tours to real top-level `Sport` values (mirroring how
   NFL/NCAA_FOOTBALL are separated today) rather than a same-provider `matchKeyword` filter.
   `SportLeague` doesn't block this — it's additive data either way — but
   `listCandidateEvents`'s `getUpcomingEvents('GOLF', ...)` call would need to become
   tour-aware at that point. Not blocking now; flagged so it isn't rediscovered as a surprise
   later.
5. ~~**Provider-event overrides for legacy (`FULL`) events.**~~ **Confirmed: stay blocked.**
   Admin golf mutations on `syncScope = 'FULL'` events remain rejected
   (`409 EVENT_NOT_ADMIN_MANAGED`); an admin who needs to intervene downgrades `syncScope`
   first. No break-glass path built.
6. **`Sport` row prerequisite.** Manual tournament creation requires a golf `Sport` row
   (`Sport.name` is unique and `persistParticipants` upserts it as a side effect of sync).
   With no sync, it must exist. Assumption: guarantee it via migration seed and fail with a
   clear error otherwise. Full sport CRUD is out of scope.
7. ~~**Cut handling.**~~ **Confirmed.** No explicit cut-line concept or "apply cut" action.
   `PrismaGolfLiveStatus.MISSED_CUT` is set the same way any other round status is — via the
   upload/correction path (§6.3) — on the assumption that a real feed simply stops reporting
   scores for cut players rather than PoolMaster needing to compute who's cut. Revisit only if
   that assumption turns out wrong once a real feed is in use.
8. ~~**Tier definition changes after entries exist.**~~ **Confirmed.** `ContestEntryPick.tier`
   stamps the tier key at pick time. Re-tiering a locked field would desynchronize existing
   picks — and now that tiers are event-level only (§4.6), a re-tier potentially affects every
   contest on the event, not just one. Tier edits are blocked once any contest on the event
   has entries (`409 TIERS_LOCKED_BY_ENTRIES`).

   A related but separate concern was raised and is already handled by existing,
   pre-existing code, not something this plan needs to build: whether an admin can set up an
   event (create it, load its field) *before* any league can see or enter contests against
   it. `SportEvent.releaseAt`/`.fieldLocksAt` and `evaluateEventOperationalState`
   (`operational-timing.ts`) already gate this — `contest-management/service.ts`'s
   `assertSportEventContestEligible` (lines 303–359) rejects contest creation with
   `SPORT_EVENT_NOT_RELEASED` before `releaseAt`, and `SPORT_EVENT_FIELD_NOT_LOADED` before
   the field has any golfers — both pre-existing, unrelated to this plan, and reused as-is.
   An admin can freely build out a manual tournament's field and tiers ahead of `releaseAt`
   with zero risk of a contest attaching to it early.
9. **Re-seeding after the league roster's rankings change.** "Seed field from league roster"
   (§4.7) is a one-time copy + derivation at the moment it's clicked. If the roster is updated
   afterward (a later bulk ranking upload) and the tournament's field was already seeded,
   should there be a "refresh from roster" action, and should it overwrite per-golfer
   adjustments already made in the field editor? Assumption: no automatic refresh; re-running
   the seed action only adds newly-affiliated golfers, it does not touch existing field rows.
   A "refresh unedited rows" action is a reasonable follow-up, not required for this epic —
   say the word and it's added as a slice.
10. ~~**Odds/seed/price algorithm calibration.**~~ **Confirmed: ship the first-pass formulas
   as-is.** The §4.7/§4.7a formulas (`weight = 1/position`, ±15% jitter, min-max rescaled for
   price) are a first pass with no real market data behind them, and that's fine — each is a
   small follow-up change to one pure function if it needs tuning after real fields are seen.
11. ~~**Audit shape for system-driven lifecycle transitions.**~~ **Confirmed: reuse
   `AdminAuditEntry` with a `SYSTEM` actor row.** §3.6's scheduler-driven transitions get a
   row in the existing admin-audit table (actor `{ type: 'SYSTEM', reason:
   'SCHEDULED_LIFECYCLE' }`, already the shape §3.6 calls `applySportEventStatusTransition`
   with) rather than a second, dedicated `EventLifecycleLog` table. "Why did this go Live" is
   answerable from the same table for both admin and scheduler-triggered transitions.
12. ~~**Sweep interval and near-boundary timing.**~~ **Confirmed: every 5 minutes, fixed
   platform-wide, no per-tournament override.** `event-lifecycle-scheduler.ts` (§3.6) polls on
   a 5-minute interval; a few minutes of lag between the recorded round time and the actual
   status flip is acceptable — it governs contest activation and score-sync eligibility, not
   anything requiring second-level precision, and is strictly better than the status quo (an
   admin who forgets to click the button).

## 10. Out of scope

- **Any other sport's admin UI, routes, or sport-specific business logic.** No basketball or
  football admin screens, no `/sports/basketball/*` or `/sports/football/*` routes, no
  basketball- or football-shaped services (bracket seeding, conference tie-breakers, etc.)
  ship in this plan. What *does* ship, and is deliberately built cross-sport rather than
  golf-only, is the shared substrate those future plans would build on: `SportLeague`,
  `Season`, `ParticipantLeagueAffiliation` (§4.2), the `modules/sport-catalog/` service (§3.2), and
  `event-score-source-service.ts` (§3.4, §4.4). A future basketball or football admin plan
  reuses those tables and services as-is and adds only its own route lane plus whatever is
  genuinely sport-specific — mirroring exactly how this plan added `modules/golf/` beside the
  already-generic `SportEvent`/ingestion substrate. The navigation grouping (§6.1) is likewise
  additive: a new sport is one more tile, one more route subtree.
- Replacing or removing the mock provider. Both lanes remain fully functional.
- Contest-side scoring rules, prize definitions, or draft mechanics.
- `plans/122`'s `COMPLETED → OFFICIAL` closeout and its `EVENTRESULTS` persistence bridge.
  Not a dependency of this plan (§1) — dropped from scope, not deferred; revisit only if a
  concrete need for a post-completion corrections window resurfaces.
- Mobile clients.
