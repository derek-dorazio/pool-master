# Sync Flow Deprecation — Admin-Authored Events, Optional Field/Odds Complement

> **Status:** Draft for user review. No Beads epic opened yet. Depends on
> `plans/124-golf-admin-tournament-management.md` (the admin-authoring + score-linking
> pattern this plan reduces sync's role around). Cross-sport, not golf-specific — same
> relationship `plans/124`'s `modules/sport-catalog/` has to golf.

---

## 1. Context

Across this conversation, the golf admin plan (`plans/124`) progressively narrowed sync's
necessary role: first to "admin authors setup, sync still creates events" (rejected), then to
"admin authors events, sync may still auto-populate field/rankings" (also too broad), landing
on: **admin creates and links events; sync's only indispensable job is scores for an
already-linked event.** This plan checks that conclusion against the actual sync code, and
turns it into a concrete deprecation: which feeds stop running automatically, which become
optional on-demand complements, and which are untouched.

The motivating problem, in the user's words: sync functionality has been "confusing analysis
and interfering with a better design." The fix is not to delete sync — scores must keep
flowing in near real time (`plans/124`'s core requirement) — it's to stop treating the other
sync feeds as required infrastructure when they're actually optional conveniences that may
not even exist for every sport/league.

---

## 2. What the code actually does today (verified, not assumed)

Four feed types exist in `IngestionScheduler`
(`packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts`), each independently
toggleable via `IngestionScheduleConfig`
(`packages/core-api/src/modules/admin/ingestion-config-service.ts`):

| Feed | Function | What it writes | Default `enabled` / interval |
|---|---|---|---|
| `EVENTSCHEDULE` | `runScheduleSync` (line 716) → `provider.getUpcomingEvents` → `callbacks.onEvents` → `IngestionPersistence.persistEventsWithDiagnostics` | **Creates/upserts `SportEvent` rows, including `status`** | `true` / 1440 min |
| `EVENTPARTICIPANTS` | `runEventFieldSync` (line 776) | `SportEventParticipant` (field), plus upserts the global `Participant` roster | `true` / 360 min |
| `PARTICIPANTRANKINGS` | (sport sync path) | `ParticipantRankingSnapshot` (global) + copies into `SportEventParticipant.worldRanking`/`.oddsToWin` — **deleted entirely, not just demoted, §3.2a** | `true` / 1440 min |
| `EVENTLIVESCORES` | `runConfiguredEventSyncSweep(sport, 'EVENTLIVESCORES')` → `score-publisher.ts` | `SportEventParticipantGolfRound`/`GolfStanding` | `true` / 300 sec |
| `EVENTRESULTS` | `runConfiguredEventSyncSweep(sport, 'EVENTRESULTS')` | Fetched, then discarded — no persistence today (per `plans/122`'s own audit; that plan is dropped, §3.3a) | `true` / 30 min |

**The finding that matters most:** `persistEventsWithDiagnostics`
(`ingestion-persistence.ts:98`) is not just "create a new event" — it's the **only** function
that writes `SportEvent.status` for a row that already exists, and it directly calls
`activateContestsForStartedEvent` / `settleContestsForCompletedEvent` (lines 185–186) whenever
status lands on `IN_PROGRESS` / `COMPLETED`. It is called from exactly one place:
`runScheduleSync`, the `EVENTSCHEDULE` feed. So `EVENTSCHEDULE` isn't only responsible for
event *creation* — today, it's also the only thing keeping an *existing* event's status
current, which is what drives contest activation and settlement.

That matters because `plans/124` §3.3 already gives an admin manual control over the
exact same transitions (`applySportEventStatusTransition` / `adminTransitionGolfTournament`,
the workflow rail). Once admin drives status directly, `EVENTSCHEDULE`'s entire value
proposition — create the row, keep its status current — is redundant for any admin-managed
event. There is nothing left for it to do that the admin isn't already doing on purpose.

Each feed's scheduling loop checks `config.<feed>.enabled` and fully skips itself when false
(`ingestion-scheduler.ts:478,506,564`) — confirmed by reading the code, not assumed. Flipping
defaults is a genuine config change with no scheduler code to touch.

**Admin-facing sync UI today**, for context on what a deprecation touches:
`root-admin-sync-dashboard-page.tsx` (overview + run-history), `root-admin-run-sport-sync-page.tsx`
(triggers `SPORT_SYNC_FEEDS = ['EVENTSCHEDULE', 'PARTICIPANTRANKINGS']` as one bundle),
`root-admin-run-event-sync-page.tsx` (triggers `EVENT_SYNC_FEEDS = ['EVENTPARTICIPANTS',
'EVENTLIVESCORES', 'EVENTRESULTS']` against one existing event). The bundling itself is a
symptom of the current design: "prepare a sport" conflates event-creation (deprecated below)
with rankings (kept, but demoted to optional); "sync an event" conflates field/rankings
(optional) with scores (never optional).

---

## 3. Target design

### 3.1 `EVENTSCHEDULE` — deleted entirely, not just defaulted off

Admin always creates the event (`plans/124` §4.3 — season required at creation) and always
drives its status transitions manually (§3.2's `applySportEventStatusTransition`). Sync has
nothing left to contribute here — this plan's own analysis already says so; there is nothing
left for `EVENTSCHEDULE` to do that the admin isn't already doing on purpose. An earlier draft
of this plan kept the code as an idle "legacy fallback," reasoning that deleting working code
that costs nothing while idle isn't a simplification by itself. The user overrode that
reasoning directly: an unused feed toggle with nothing left to drive is exactly the kind of
"stubbed out for later" residue that confuses a *future* sync/multi-sport redesign rather than
protecting it — if a later sport genuinely needs scheduled event discovery, that epic builds it
to that sport's actual contract, the same way every other table/service in `plans/124` got
built to spec rather than kept ahead of need.

**Decision: delete `runScheduleSync`, `IngestionScheduleConfig.eventSchedule`, and its call
into `persistEventsWithDiagnostics`'s status-driving path entirely.** This resolves §7's
former open question 1.

**What stays, and why it isn't the same thing.** `provider.getUpcomingEvents` — the method
`runScheduleSync` called — is not itself deprecated. `plans/124` §5.2's
`adminListProviderCatalogEvents` (the "browse events by sport/league/date and pick one to
link" action) calls it directly and live, on demand, at the moment an admin browses — never on
a recurring schedule, never writing `SportEvent.status`. That's a genuinely different use of
the same provider method: a one-time discovery lookup behind an explicit admin click, not a
toggleable background feed. Keep `getUpcomingEvents` on the provider interface; delete only
the scheduled job built on top of it.

**Mock provider side of the same deletion.** The mock's `/v1/scenarios/:id/events` list route
stays — it's what `getUpcomingEvents` calls, and it's the same route the catalog-browse action
needs. Nothing to delete there beyond the scheduled-job code on the core-api side.

### 3.2 `EVENTPARTICIPANTS` — optional, on-demand complement only

Populates field data. `plans/124` already gives admin three self-sufficient ways to get this
in without sync: seed the field from the league roster + derivation algorithm (§4.7), create
the tournament directly from a browsed provider event with its field pulled in immediately
(§4.4a — a one-time import at creation, not a recurring feed), and — new in this plan, §3.5
below — bulk-upload field data sourced externally. A provider's field feed, when one exists, is
a nice-to-have refresh on top of that, not a dependency. Default flips:
`eventParticipants.enabled: false`. The manual trigger (`adminSyncProviderEventData`) stays
available on the generic sync-lane page, but only for an already-linked event
(`syncScope != 'NONE'`, reusing `plans/124` §4.4's exact gate — there is nothing to sync field
data *into* for an unlinked event, and no provider identity to call); for golf specifically,
`plans/124` §4.4a's dedicated **Load/Refresh Participant Field** button on the Field editor is the primary,
tournament-scoped surface for the same underlying `golf-field-service.seedFieldFromProvider`
call — both surfaces call the identical shared implementation, per the lane-separation
architecture (`plans/124` §3). The UI must treat "this provider doesn't offer this feed for
this league" as a normal empty state, not an error — the user's point that this "cannot be
mandatory, just optional" applies per-league, not just per-sport.

### 3.2a `PARTICIPANTRANKINGS` — retired, not just demoted, along with `ParticipantRankingSnapshot`

Different treatment from `EVENTPARTICIPANTS`, on purpose: an earlier draft of this plan
grouped these together as "demote both to optional." That undersold what's actually going on.
`ParticipantRankingSnapshot` (the table this feed writes) is a **global**, provider-scoped
ranking history — verified as its only writer/reader is `ingestion-persistence.ts`
(`.upsert` and `findLatestRankingForEventParticipant`), which copies the latest snapshot onto
`SportEventParticipant.worldRanking`. `plans/124` §4.7 introduces a second, competing "current
world ranking" concept — the admin-owned `ParticipantLeagueAffiliation.worldRanking` — and every
admin-managed golf event derives its field ranking from that, never from
`ParticipantRankingSnapshot`. Keeping both around isn't "an optional complement," it's two
systems answering the same question, which is exactly the kind of drift this whole
conversation has been removing everywhere else it's found.

**Decision: delete `ParticipantRankingSnapshot` and the `PARTICIPANTRANKINGS` feed entirely**,
not just default it off. `IngestionPersistence.persistRankingsWithDiagnostics` and
`findLatestRankingForEventParticipant` are removed. `EVENTPARTICIPANTS` (§3.2, still an
optional complement) loses only its ranking-copy sub-step — it still creates/updates
`SportEventParticipant` rows from the raw provider payload when enabled, it just no longer
also reaches into a global snapshot table to backfill `worldRanking`; for an admin-managed
event that value already comes from the league roster. `adminPrepareSportSync`'s
`SPORT_SYNC_FEEDS` bundle drops `PARTICIPANTRANKINGS`, leaving `EVENTSCHEDULE` as its only
remaining (also legacy/advanced, §3.1) member — worth reconsidering whether "prepare sport
sync" still earns its own page once it's down to one feed (§7, open question).

**Mock provider side of the same deletion.** Verified `provider.getRankings()`
(`provider-interface.ts:36`) has exactly one caller anywhere in the codebase:
`ingestion-scheduler.ts`'s `PARTICIPANT_RANKINGS_SYNC` job — the exact job this section
retires. Once that job is gone, the mock's `rankings` feed kind has no remaining consumer.
Delete it in the same slice: the `rankings` entries in `contracts.ts`'s `feedKinds` /
`updateKinds` / `feedSnapshotSchema`, the per-event `feeds.rankings` records in
`scenario-store.ts`, the `getMockContestFeedRankingsSnapshot` route, and its swagger entry.

### 3.3 `EVENTLIVESCORES` — untouched, remains default-on

This is the entire point of linking (`plans/124` §4.4). No change. By the time an admin moves
a tournament to Live, the provider link is already established (created explicitly, before
Live, via the score-source picker) — sync's job starts exactly where the admin's job ends.

### 3.3a `EVENTRESULTS` — deleted entirely

An earlier draft of this plan grouped `EVENTRESULTS` with `EVENTLIVESCORES` as "the entire
point of linking, don't touch it." That was wrong: `EVENTRESULTS`' only stated purpose was
feeding `plans/122`'s `COMPLETED → OFFICIAL` closeout (§2's table — "drives `plans/122`'s
`COMPLETED → OFFICIAL`"), and that plan is now dropped (`plans/124` §1, per the user's
decision — its premise, a corrected-results payload arriving after completion, doesn't apply
under the admin-managed model). Per `plans/122`'s own audit, `EVENTRESULTS` **today already
just fetches a payload and discards it** — no persistence, no reprocessing happens with it.

A second earlier draft moved it into §3.2's optional/on-demand bucket alongside
`EVENTPARTICIPANTS`, reasoning that fetch-and-discard is harmless. The user's review of the
domain vocabulary settled the terminology question this raised and, with it, this feed's fate:
PoolMaster's own domain model already has one term for a golfer's achievement in an event —
**score**, not "result" (`SportEventParticipantGolfRound.scoreToPar`,
`SportEventParticipantGolfStanding`, `ContestEntryGolfStanding`, `score-publisher.ts`, the
`live_score.persisted` event-bus topic, and every operationId in `plans/124`'s scores API —
`adminGetGolfRoundScores`, `adminPreviewGolfRoundScores`, `adminApplyGolfRoundScores`).
"Result" appears only in the ingestion/provider layer being retired here (`ProviderEventResult`,
`getEventResults`, `EVENTRESULTS`) and in the `espn-adapter.ts`/`openf1-adapter.ts` files
already slated for deletion (`plans/124` §4.11) — nowhere in the golf domain model itself. A
feed that duplicates a concept PoolMaster already has a canonical name and table for, does
nothing with its payload, and only existed to feed a dropped workflow has no remaining reason
to exist even as an optional capability.

**Decision: delete `EVENTRESULTS` entirely, not demote it.** `IngestionScheduleConfig.eventResults`,
its `runConfiguredEventSyncSweep(sport, 'EVENTRESULTS')` job, and `getEventResults`/
`ProviderEventResult` on `provider-interface.ts` are all removed. Verified `getEventResults`/
`ProviderEventResult` have exactly four references in `packages/core-api/src`: the
`provider-interface.ts` declaration, the `ingestion-scheduler.ts` job being deleted here, and
the mock/espn/openf1 adapter implementations — the latter two already slated for deletion — so
nothing is orphaned by removing it. `EVENTLIVESCORES` alone is what's load-bearing — it's the
only feed genuinely required once an event is linked, since it's the only one driving something
a member actually sees in real time, and it stays named "scores," matching the domain
vocabulary it already shares with everything downstream of it.

**Mock provider side of the same deletion.** Delete the `results` feedKind entry in
`contracts.ts` and its route (`getMockContestFeedResultsSnapshot`). Two more dead routes
surfaced in the same audit pass, unrelated to any specific feed but found while tracing every
route's real callers: the bare `getMockContestFeedScenarioEvent`
(`/v1/scenarios/:id/events/:eventId`) has zero callers anywhere — not the adapter, not a test
— and `getMockContestFeedEventUpdates` (`/v1/scenarios/:id/events/:eventId/updates`) has zero
*production* callers; it's exercised only by the mock package's own tests
(`scenario-store.test.ts`, `mock-contest-feed-provider.integration.ts`), which is itself a
symptom of unused surface area rather than evidence it's needed. Delete both routes and their
now-unreferenced tests.

### 3.4 Admin sync UI rework

- **`root-admin-run-sport-sync-page.tsx` ("Prepare Sport Sync") is deleted, not relabeled.**
  Its `SPORT_SYNC_FEEDS` bundle already dropped to `['EVENTSCHEDULE']` once `PARTICIPANTRANKINGS`
  was removed (§3.2a); now that `EVENTSCHEDULE` itself is deleted (§3.1), the page has nothing
  left to trigger. This resolves §7's former open question 2 — an earlier draft leaned toward
  keeping it reachable as a relabeled legacy page "in case a QA bootstrap use case needs it,"
  but there's no feed left underneath it to bootstrap. The catalog-browse action
  (`plans/124` §5.2's `adminListProviderCatalogEvents`) is the actual replacement UI for
  "find a provider event," and it lives on the tournament-linking screen, not `/manage/sync`.
- `root-admin-run-event-sync-page.tsx`: `EVENT_SYNC_FEEDS` drops to `['EVENTPARTICIPANTS',
  'EVENTLIVESCORES']` — `EVENTRESULTS` no longer exists as a feed to include (§3.3a). Default
  its target-event picker to admin-linked (`syncScope != 'NONE'`) events; label
  `EVENTPARTICIPANTS` as optional best-effort, `EVENTLIVESCORES` as the primary action.
  (`PARTICIPANTRANKINGS` was never actually one of this page's feeds — it's sport-level, §2's
  table — so it drops out of this page's description without otherwise changing what this page
  does.)
- `root-admin-sync-dashboard-page.tsx`: no structural change — run history remains useful for
  whichever feeds are actually enabled. Its "Prepare Sport Sync" navigation entry is removed
  along with the page.

### 3.5 New golf capability this deprecation depends on: "Field Participant Data Upload"

For `EVENTPARTICIPANTS` to be safely optional rather than load-bearing, admin needs a way to
get externally-sourced field/odds/seed data in without a provider feed — e.g., data the admin
copied from the tournament's own website. This is a fourth field-population path alongside
`plans/124`'s existing three (seed from league roster + algorithm, §4.7; add one golfer at a
time, §5.2; the now-optional provider sync, §3.2 above):

| Method + path | operationId | Notes |
|---|---|---|
| `POST /sports/golf/tournaments/:eventId/field/upload/preview` | `adminPreviewGolfFieldUpload` | **Dry run.** Same CSV/JSON paste-or-upload contract as round scores and league rosters (`plans/124` §5.2, §6.4's shared `BulkUploadPanel`): rows resolve to golfers by `participantId` > `externalId` > exact `playerName`; unresolved/ambiguous rows are reported, never silently guessed. Row shape: `externalId or playerName, worldRanking?, oddsToWin?, seedNumber?, isActive?, inactiveReason?` (`plans/124` §4.1). |
| `POST /sports/golf/tournaments/:eventId/field/upload/apply` | `adminApplyGolfFieldUpload` | Applies a previewed upload — creates or updates `SportEventParticipant` rows exactly as `adminUpdateGolfFieldEntries`/`adminBulkAddGolfFieldEntries` would, just in bulk. `422` when any row is unresolved. |

UI: the Field editor (`plans/124` §6.3) gains a **Bulk upload** action opening the same
paste/upload/preview/apply panel already used for round scores and the league roster —
identical shape, different row schema, zero new UI pattern to design. This is the mechanism
the user described as "screen-scraped from the event's website."

---

## 4. Relationship to other plans

- **`plans/124`**: this plan is the fuller version of its §3.5 "platform-wide feed
  deprecation stays a config change" point — that section can now cross-reference this plan
  for the actual default-flip decision instead of describing it as a someday-maybe toggle.
  `plans/124`'s Field section gains the bulk-upload capability described in §3.5 above.
  `plans/124` §3.6/§4.10 (the algorithmic lifecycle scheduler) is what makes §2's headline
  finding fully actionable rather than admin-dependent: status — whichever caller sets it,
  a human clicking the workflow rail or the scheduler comparing recorded round dates against
  the clock — is what already gates `EVENTPARTICIPANTS`/`EVENTLIVESCORES` eligibility. This
  plan's defaults don't need admin follow-through to take effect once §3.6 ships.
- **`plans/122`** (golf official-results / `EVENTRESULTS` bridge): dropped, per `plans/124`
  §1 — not built, not a dependency of either plan here. `EVENTRESULTS` is deleted entirely
  (§3.3a) as a direct consequence: its only stated purpose was feeding 122, and it duplicated
  a concept ("score") PoolMaster already names and models elsewhere.
- **`plans/123`** (workflow gate hardening): unaffected; its shared-enum work is orthogonal.

---

## 5. Slice sequence

| # | Slice | Depends on |
|---|---|---|
| 1 | Flip `IngestionScheduleConfig.eventParticipants` default to `enabled: false` (`eventLiveScores` stays `true`); update any test asserting the old default | — |
| 2 | Gate `adminSyncProviderEventData`'s `EVENTPARTICIPANTS` action behind `syncScope != 'NONE'` (reuses `plans/124` §4.4's guard) | `plans/124` slice 5 |
| 3 | Delete `ParticipantRankingSnapshot`, `IngestionPersistence.persistRankingsWithDiagnostics`, `findLatestRankingForEventParticipant`, the `PARTICIPANTRANKINGS` feed type and its `IngestionScheduler`/`sync-orchestrator.ts` handling entirely, plus the mock's `rankings` feedKind/route (§3.2a) | — |
| 4 | Delete `runScheduleSync`, `IngestionScheduleConfig.eventSchedule`, and its `persistEventsWithDiagnostics` status-driving call entirely; repoint nothing — `getUpcomingEvents` stays on `provider-interface.ts` for `plans/124`'s catalog-browse action and its "browse provider events" tournament-creation flow to call directly (§3.1, `plans/124` §4.4a) | `plans/124` slice 12 (catalog-browse action must exist before the scheduled path it replaces is removed) |
| 5 | Delete `EVENTRESULTS` entirely: `IngestionScheduleConfig.eventResults`, its `runConfiguredEventSyncSweep` job, `getEventResults`/`ProviderEventResult` on `provider-interface.ts`; delete the mock's `results` feedKind/route plus the two dead routes found in the same audit (`getMockContestFeedScenarioEvent`, `getMockContestFeedEventUpdates`) and their now-unreferenced tests (§3.3a) | — |
| 6 | `adminPreviewGolfFieldUpload` / `adminApplyGolfFieldUpload` routes + service (extends `golf-field-service.ts`) | `plans/124` slice 8 |
| 7 | Frontend: Field editor bulk-upload panel (reuses `BulkUploadPanel`, `plans/124` §6.4) | 6, `plans/124` slice 16 |
| 8 | Delete `root-admin-run-sport-sync-page.tsx` ("Prepare Sport Sync") and its navigation entry entirely; simplify `run-event-sync-page.tsx` to `EVENT_SYNC_FEEDS = ['EVENTPARTICIPANTS', 'EVENTLIVESCORES']` + empty-state handling for leagues with no field feed | 1, 2, 3, 4, 5 |
| 9 | Docs: note in `rules/architecture-rules.md` or an ADR that admin-authored events + score-only linking is the only pattern; sync-driven event creation and results fetching are removed, not legacy | 1, 3, 4, 5 |

---

## 6. Verification

- *Unit* — `IngestionScheduleConfig`'s new `eventParticipants` default; the
  `syncScope != 'NONE'` gate on `adminSyncProviderEventData`'s field action (`403`/`409` when
  unlinked); field upload row-resolution precedence (same rule as round scores/league roster).
- *Integration* — assert `EVENTSCHEDULE` and `EVENTRESULTS` no longer exist as feed types at
  all (not merely disabled) — no config key, no scheduler job, compile-time absence of
  `getEventResults`/`ProviderEventResult`; assert `EVENTPARTICIPANTS` exists but is disabled by
  default while `EVENTLIVESCORES` still runs; assert `PARTICIPANTRANKINGS` is gone as a feed
  type entirely and that `ParticipantRankingSnapshot` no longer exists as a table; assert
  `provider.getUpcomingEvents` still works when called directly by the catalog-browse action,
  proving its removal from the scheduler didn't remove the method itself. Existing FAPI/
  integration tests that assumed schedule-sync auto-creates events, or that fetched
  `EVENTRESULTS`/hit the deleted mock routes (sweep and inventory before this ships — likely
  candidates: `tests/integration/core-api/mock-contest-feed-provider.integration.ts` and
  `packages/mock-contest-feed-provider/src/scenario-store.test.ts`) get updated to create
  events via the admin API instead, or deleted if they had no purpose beyond exercising removed
  surface area.
- *Manual* — confirm `/manage/sync-config` shows only `eventParticipants` and `eventLiveScores`
  as toggles, `/manage/sync` no longer lists "Prepare Sport Sync," and flipping
  `eventParticipants` back on for GOLF (if ever desired) still works exactly as before —
  nothing about the mechanism changed, only its default.

---

## 7. Open questions

1. ~~Delete `runScheduleSync`/`EVENTSCHEDULE` eventually, or keep it permanently as a legacy
   fallback?~~ **Confirmed: delete it entirely (§3.1).** The user rejected "deleting working,
   idle code isn't a simplification by itself" as the wrong frame here — an unused toggle with
   nothing left to drive is exactly the kind of stubbed-out-for-later residue that confuses a
   future sync/multi-sport redesign. If a later sport genuinely needs scheduled discovery,
   that epic builds it to that sport's real contract, same as everything else in `plans/124`.
2. ~~Should "Prepare Sport Sync" be removed from `/manage` navigation entirely, or kept as a
   clearly-labeled advanced/legacy page?~~ **Confirmed: removed entirely (§3.4).** Once
   `EVENTSCHEDULE` is gone (1), the page has nothing left to trigger.
3. ~~Existing test inventory.~~ **Swept. Concrete findings below, organized by what's deleted.**
   Verified by reading each file, not just grepping for the symbol name.

   **`EVENTSCHEDULE`/`runScheduleSync` (slice 4) — six files, most need a fixture-value swap,
   two need real rework:**
   - `tests/unit/core-api/ingestion-scheduler.test.ts` — 13 references. Most use `'EVENTSCHEDULE'`
     as a generic example feed name for testing scheduler/orchestrator mechanics unrelated to
     the feed itself (job creation, dedup) — swap to `'EVENTPARTICIPANTS'` or `'EVENTLIVESCORES'`
     and the tests still prove the same thing. Two need real rework, not a swap: `it('start()
     begins polling and runs startup schedule, field, and ranking syncs')` (~line 1254) and
     `it('pool-master-r04 schedules only sports enabled by ingestion sync config')` (~line 1316)
     — both directly assert `EVENTSCHEDULE`'s own scheduled behavior at startup, which no
     longer exists.
   - `tests/unit/core-api/admin-provider-sync-authz.test.ts`,
     `tests/unit/core-api/sync-orchestrator.test.ts`,
     `tests/unit/core-api/sync-orchestration-equivalence.test.ts`,
     `tests/unit/core-api/provider-sync-run-ledger.test.ts`,
     `tests/unit/core-api/admin-support-services.test.ts` — same pattern: `EVENTSCHEDULE` used
     as a generic example feed (5–12 occurrences each) for authz/orchestration/ledger mechanics
     that apply to any feed. Fixture-value swap, not a logic change, in all five.
   - `tests/integration/core-api/mock-contest-feed-provider.integration.ts` —
     `pool-master-rop.68.1.7` (~line 667) directly calls
     `providerService.prepareSportSync({ feeds: ['EVENTSCHEDULE'] })` and asserts a real
     `EVENT_SCHEDULE_SYNC` job ran. Real rework: either delete this portion of the test or
     replace the setup path with direct admin-API tournament creation, matching §6's own note.
   - `tests/integration/core-api/contract-verification-root-admin.integration.ts` (lines
     792/797/843/983) and `tests/functional/root-admin.functional.ts` (lines 101/442) — both
     exercise the sport-sync-preparation endpoint with `EVENTSCHEDULE` in the feed list; needs
     updating once that endpoint's valid feed set changes (and once §3.4's page deletion lands,
     `root-admin.functional.ts`'s coverage of it may need to move or be dropped entirely).

   **`PARTICIPANTRANKINGS`/`ParticipantRankingSnapshot` (slice 3) — three files:**
   - `tests/unit/core-api/ingestion-persistence.test.ts` — directly tests the function being
     deleted: `persistRankingsWithDiagnostics` is called and asserted against
     (`entityType: 'ParticipantRankingSnapshot'`) at lines 343 and 392–412. **Delete these test
     blocks outright** — the function won't exist to call.
   - `tests/unit/core-api/ingestion-scheduler.test.ts` (lines 477, 487, 776) and
     `tests/unit/core-api/sync-orchestrator.test.ts` (lines 31, 44, 136, 145) — `PARTICIPANTRANKINGS`
     used both as a feed-list member in generic tests (swap out) and, in a couple of cases, as
     the specific thing being scheduled (`PARTICIPANT_RANKINGS_SYNC` jobType) — those latter
     assertions get deleted along with the feed.

   **`EVENTRESULTS`/`getEventResults`/`ProviderEventResult` + the two dead mock routes
   (slice 5) — six files:**
   - `tests/unit/core-api/ingestion-scheduler.test.ts` (lines 1037–1186) — a dedicated block
     testing `runConfiguredEventSyncSweep(..., 'EVENTRESULTS')` end to end, including
     `ProviderEventResult` construction. **Delete this block** — the sweep target won't exist.
   - `tests/unit/core-api/ingestion.test.ts` (line 32) and
     `tests/unit/core-api/ingestion-scheduler.test.ts` (lines 20, 39, 177, 1007) — mock provider
     stubs including a `getEventResults` method on an otherwise-unrelated fake provider object;
     harmless to leave as dead stub code but cheap to remove for cleanliness.
   - `tests/unit/core-api/scheduled-event-reader.test.ts` (line 96) — one test case using
     `'EVENTRESULTS'` as the feed under test for the reader's `toFeedWhere` branch; that branch
     is deleted with the feed, so this case is deleted too.
   - `tests/unit/core-api/mock-contest-feed-adapter.test.ts` (lines 233, 273) — directly tests
     the mock adapter's own `getEventResults` implementation. Deleted along with it once the
     mock's `results` feedKind/route goes.
   - `packages/mock-contest-feed-provider/src/scenario-store.test.ts` (line 26, 29) — directly
     calls `store.getUpdates(...)` and asserts `feedKind === 'results'`; this **is** the dead
     `/updates` route's own regression test, per §3.3a's finding that this route is exercised
     only by the mock package's own tests. Delete it. (Lines 211/329/530 in the same file also
     reference a `'results'` feedKind value in generic snapshot-shape assertions — worth a
     closer look at implementation time to confirm which of those are testing the `results`
     feedKind specifically, versus reusing it as an arbitrary example value for other coverage.)
   - `tests/integration/core-api/mock-contest-feed-provider.integration.ts` (line 544) — hits
     `GET .../events/:eventId/updates` directly. Delete this assertion along with the route.

   **Zero findings, explicitly checked, not just omitted:**
   - **Old `IngestionScheduleConfig` defaults** (`eventSchedule`/`eventParticipants`/
     `eventResults` asserted `true`) — no test anywhere asserts these specific default values;
     every reference sets them explicitly per-test. **Low risk**: flipping the defaults (slice 1)
     doesn't require hunting down assumed-default assertions, because there aren't any.
   - **`msw-api.ts` / frontend operationId registrations** for any of the deleted mock-provider
     routes (`getMockContestFeedRankingsSnapshot`, `getMockContestFeedResultsSnapshot`, the two
     dead scenario/update routes) — zero references anywhere in `clients/poolmaster/src`. These
     are internal to the mock package, never part of PoolMaster's own generated SDK the
     frontend consumes, so there is nothing to clean up on the frontend mock-registration side.
     Also checked for lingering `adminGetGolfSeasonRoster`-family references from `plans/124`'s
     roster restructuring — none found; that rename was already fully clean.

   **Admin sync UI pages (slice 8) — three test files exist, one per page, dispositions differ:**
   - `root-admin-run-sport-sync-page.test.tsx` — tests the page being **deleted entirely**
     (§3.4). Delete the test file with it.
   - `root-admin-run-event-sync-page.test.tsx` — tests the page being **simplified**
     (`EVENT_SYNC_FEEDS` drops to two members). Needs updating, not deletion.
   - `root-admin-sync-dashboard-page.test.tsx` — the page itself has "no structural change"
     per §3.4, but loses its "Prepare Sport Sync" navigation entry; this test likely needs a
     small assertion update, not a rewrite.
