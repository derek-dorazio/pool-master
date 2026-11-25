# Live Sports Data Sync

How a sport league's data gets from a provider (BALLDONTLIE) into PoolMaster: which leagues
sync, what each sync writes, what starts it, and what a new league adds. It describes `main` and
is written for reviewing provider PRs. The plan and Derek's decisions are in
`plans/live-sports-data-balldontlie.md` (epic #1494); the background jobs named here are
specified in [`BACKGROUND-JOBS.md`](BACKGROUND-JOBS.md).

## The short version

- **Every active sport league is synced, or switched off.** A league is synced when a root admin
  sets its `event_sync_provider_id`. Leagues no provider covers are inactive (*Switched-off
  leagues*). Formula 1 is the one active league without a feed: an admin runs its events.
- **The sync owns a synced league's events** (ADR 0011). It creates them, keeps their name,
  venue and dates current, loads their fields and games, and tiers and prices the field while
  the event is a draft. **The provider wins** over an admin's edit of those details. A sync never
  sets status: status follows the dates. A draft releases itself once its ready checks pass.
- **Three syncs, one schedule.** Events (the league's event list), Field (participants and
  games) and Scores (live scores). One ingestion schedule covers every league; webhooks carry
  live scores between scheduled runs.
- **An event links to a provider by a `sport_event_provider_mappings` row** (#2004): the
  provider, its id for the event (`external_id`, unique per provider) and the league's provider
  mapping the event came under. Only the sync writes it; a test event has none. For BALLDONTLIE, which has
  games but no events, the external id is a *scope id* the adapter invents and parses back
  (`nfl-2026-week-12`, `nba-2025-postseason`).
- **An event covers Season slots by `sport_event_slots` rows** (#2004): each slot at most one
  event's, in the event's own Season, and an event with slots takes its dates from them. Only a
  test event and the migration backfill write them until slice 8 makes the sync write them. A
  test event is one on a labelled **test slot** (`is_test_data`), which the sync never reads or
  writes; every other event is the sync's, so an event is synced exactly when it covers no test
  slot (`isTestData` on the event).
- **A participant links by feed id only**, within its event's sport league. Names are never
  compared. Test data shares a row with the sync by carrying the same feed id.
- **Each league adds a reader, not a pipeline**: a scope id format, a few vendor reads, and a
  mapping into one of two shared shapes (`GOLF`, `GAME`).

```mermaid
flowchart LR
  subgraph Triggers
    T1[Schedule]
    T2[Admin: Sync now / event sync]
    T3[BALLDONTLIE webhook]
  end
  subgraph Core["ingestion/core"]
    S[IngestionScheduler<br/>pollLiveScores / runEventFieldSync]
    E[LeagueEventsSync]
    R[ProviderRegistry]
    L[provider_sync_runs]
  end
  subgraph Adapter["adapters/balldontlie"]
    A[BalldontlieAdapter<br/>routes by scope id]
    RD[League readers]
    C[BalldontlieClient<br/>one attempt, Zod]
    CP[ProviderCallPolicy<br/>pacing, cockatiel retry, breaker]
  end
  T1 & T2 --> E
  T1 & T2 & T3 --> S
  E & S --> R --> A --> RD --> CP --> C --> V[(api.balldontlie.io)]
  E & S --> L
  S -- scores --> P[publishLiveScoreUpdate] --> W[GOLF / GAME writer]
  S -- field --> IP[IngestionPersistence] --> GT[SYNC_EVENT_GAMES_AND_TIERS job<br/>games, then tiers and prices]
  W & IP --> J[REBUILD_LEADERBOARDS job]
```

## 1. Configuration

Each provider is a `Provider` row with its `ProviderLeague` rows (#1997), seeded by migration and
edited on the root admin's Providers page: base URL, request rate, webhook switch, safety-net
poll minutes, priority, and per league its webhook event set, `quietAfterMinutes`,
`typicalGameMinutes` and whether it is read. Each environment's database holds its own values; the
running tasks read the rows again every minute, so an edit needs no restart.
`registerConfiguredProviders` (`ingestion/core/provider-bindings.ts`) registers each enabled row's
adapter at startup, and reads only its enabled leagues. A sport league syncs from the provider
league its selected `SportLeagueProviderMapping` names; the migration mapped the leagues it could
match and selected the mapping of each league that was synced before.

Secrets stay out of the database:

| Setting | What it does |
|---|---|
| `BALLDONTLIE_API_KEY` | The vendor key, from Secrets Manager. A deployed task with an enabled row and no key fails to start. |
| `BALLDONTLIE_WEBHOOK_SECRET` | The webhook signing secret. While unset the row's webhook switch is refused on the Providers page (422 `PROVIDER_WEBHOOK_SECRET_MISSING`), a switch already on is logged at startup, every delivery is refused (403), and live scores are polled. |

Which providers run is never read from the environment: core-api builds one adapter per enabled
Provider row whose key is set, and nothing else (#2039). Functional and integration tests register
their own fake provider through `buildApp`'s provider factory, from test code.

A sport's leagues are read one by one: a league the vendor plan refuses (401/403) or whose read
fails is logged as `balldontlie.league.unavailable` and left out, so its neighbours still list.
A league the provider rate limits is never left out: the read throws its RATE_LIMITED refusal,
so the job is deferred rather than syncing a partial list (*Rate limit and retries* below).

**The schedule** is the `INGESTION_SCHEDULE_CONFIG` settings group
(`platform/ingestion-config-service.ts`), edited on the root admin's Providers page. One schedule
serves every sport league; there are no per-sport or per-league overrides, and every sport a
registered provider covers is scheduled. Its keys are the sync kinds, `ProviderSyncKind` (#1999).

| Policy | Default | Runs |
|---|---|---|
| `EVENTS.intervalMinutes` | 6 h | the Events sync of every synced league (§2) |
| `FIELD.intervalMinutes`, `lookaheadDays` | 6 h, 14 days | the Field sync (§3); it has no `enabled` switch and always runs (#2086) |
| `SCORES.intervalSeconds` | 300 s | the Scores sweep (§5); webhooks arrive between runs |

Each loop re-reads its interval after every run, so a saved change applies without a restart.
The schedule read (`GET /api/v1/platform/ingestion-schedule`) answers each kind's policy with
`runs` and `switchable`, read from whether the policy has an `enabled` switch, so the Providers
page draws its Sync schedules rows from those fields alone (#2086).

There is no health check loop and no route calls a provider live (#1999). A provider's health on
the Providers page comes from its own sync runs of the last hour: HEALTHY when none failed, DOWN
when all did, DEGRADED when some did, and unknown when none finished
(`providerHealthOfRuns`).

### Rate limit and retries

Every provider request goes through one `ProviderCallPolicy` per provider
(`ingestion/core/provider-call-policy.ts`), shared by every job on the task. The provider's HTTP
client makes one attempt per call and says what its failure was (rate limited, transient or
final); the policy is the only layer that retries.

| What | Rule |
|---|---|
| Pacing | Each task starts a request at most every `60 s × BACKGROUND_JOB_MAX_TASKS / requestsPerMinute`: an even share of the plan's limit for each task that can run background work. The limit is read for each request from the Provider row in memory, so a Providers page edit takes effect without a restart and no request waits on a database read. Set `BACKGROUND_JOB_MAX_TASKS` to the most such tasks a deploy or scale-out runs together (unset is 1, right for QA's one task). |
| Retries | A 429, a 5xx or no answer is tried up to 3 more times. A 429's Retry-After (whole seconds) is honoured up to 30 s; otherwise the wait doubles from 1 s with half jitter, capped at 30 s. Any other status, or a body that breaks the contract, is not retried. |
| Breaker | Five 429s in a row open the provider's circuit for 60 s; calls meanwhile are refused without reaching the provider. 5xx failures do not count toward it. |
| RATE_LIMITED | A call the open circuit refuses, a 429 asking for more than 30 s, or a 429 still there after every retry throws `ProviderRateLimitedError`. The sync that made the call throws it on, and the job runner queues the job again for when the provider will answer (the circuit's reopening, or the Retry-After) without counting the try toward its attempts (`docs/BACKGROUND-JOBS.md`). A manual sync's feed it turned away is marked FAILED and the feeds still waiting run on the next try. A scheduled sweep stops at it and the next tick carries on. |

A transient failure still there after the retries stays a provider error, and the job is
retried on the usual 1, 5 and 30 minutes.

**The rate-limit finding.** The policy tells `ProviderRateLimitWatch`
(`ingestion/findings/provider-rate-limit-watch.ts`) of each call that ended RATE_LIMITED and each
the provider answered. Once every call has been turned away for 15 minutes, each league the
Provider syncs gets one `PROVIDER_RATE_LIMITED` WARNING; once the streak lasts a league's
`quietAfterMinutes` it becomes an ERROR (logged for the alarm, *Sync findings* below). The
Provider's next answer resolves them. The streak is held in memory per task, so a restart begins
a new one; its first answer resolves what an earlier task left open. The leagues are read only
when a refusal comes past a threshold not yet reached, so a short burst of 429s reads nothing.

**The Providers page** also counts each provider's rate-limited jobs of the last 24 hours (jobs
whose latest try hit the client's 429). Jobs carry no provider: a job belongs to the provider
syncing its sport league or to
the provider its event is linked to.

## 2. Events sync

### What a league needs first

Seeded by migration on `sport_leagues`:

| Column | Why the sync needs it |
|---|---|
| `selected_provider_mapping_id` | Makes the league synced: its mapping to one provider league (#1997). The sync keeps the provider's events whose provider league code is that league's, never matching a name. |
| `round_series_lengths` | Best-of lengths per round for series playoffs (NBA/NHL `[7,7,7,7]`, WNBA `[3,5,7]`, MLB `[3,5,7,7]`). Empty means single games. |
| `platform_tier_profile_id`, `platform_pricing_profile_id` | The profiles the field's tiers and prices come from (§3). |
| `auto_release_days_before_start` | The auto-release window (default 7, `null` never). |
| `time_zone` | The IANA zone its calendar weeks break in (#2003). |

And its Seasons (#2003), also by migration: one `sport_league_seasons` row per championship year
(unique on league and year), and for each the provider's own id for it in
`sport_league_season_provider_mappings`, keyed by the league's provider mapping. The sync never
creates a Season. `current_season_id` is set by the nightly `currentSeasons` step
(`currentSeasonOf`), never by hand.

### The run

`SyncedEventCreationScheduler` queues one `SYNC_LEAGUE_EVENTS` job per active synced league on
the Event list policy; a root admin's **Sync now**
(`POST /api/v1/ingestion/sport-leagues/:id/events-sync`) queues the same job.
`LeagueEventsSync.run` reads the league's current Season and every later one (`seasonsToSync`),
or the one Season a **Sync now** names (`sportLeagueSeasonId`), asks the provider for each by its
own id for that Season, and records one `EVENTS` sync run. A Season the provider has no id for is
not read; when the last of them lacks one, the job raises one `SEASON_MISSING` ERROR finding per
league and provider (*Sync findings* below), since only a migration can add it. For each provider event:

- **New, start in the future**: created as a `DRAFT` `sport_events` row in the Season it was
  read for, on the league (`sport_league_id`), kept under the provider's id for it: a
  `sport_event_provider_mappings` row under the league's selected provider mapping, written in the
  same transaction.
- **New, start already passed**: never created (`ALREADY_STARTED`).
- **Already linked**: kept current (`SportEventService.keepProviderEventsCurrent`) through
  `updateEvent`, the admin's own edit, so a moved start shifts the rounds and notifies leagues
  on a released event. A value the provider stops sending is kept.

| Status | Provider may change |
|---|---|
| `DRAFT`, `SCHEDULED`, `POSTPONED` | name, venue, start, end |
| `IN_PROGRESS` | name, venue, end |
| `COMPLETED`, `CANCELLED` | nothing |

On a synced event the admin's Edit details shows name, venue and dates read-only
(any event that is not a test event, `SportEventDto.isTestData` false); location, rounds, field, tiers, prices, release and result entry
stay the admin's. The older admin routes (Create from provider event, Link score source under
`/api/v1/events`) remain as a fallback for an event the feed lacks; the Year import went with
event years (#2003).

### Auto-release

`SportEventAutoReleaseScheduler` runs hourly and queues a `RELEASE_SPORT_EVENT` job per synced
draft inside its league's `auto_release_days_before_start` window. The job judges every ready
check: all passing releases the event through the manual button's path; any failing holds it.
Each attempt is stored on the event (`auto_release_checked_at`, `_outcome`, `_failed_checks`) and
shows in Activity; a repeat hold for the same failed checks is not logged again. An admin can
release earlier by hand. `sport_events.released_at` records every release.

## 3. Field sync

The Field loop runs every participant interval over each provider's next two `DRAFT` or
`SCHEDULED` events of synced leagues starting inside the lookahead window. An admin's **Load
Participant Field** (`POST /api/v1/events/:eventId/participants/refresh`) queues a
`MANUAL_EVENT_SYNC` job down the same path: `runEventFieldSync` →
`provider.getEventDetails(externalId)` → `IngestionPersistence.persistEventDetailWithDiagnostics`.
The games and then the tiers and prices follow in one `SYNC_EVENT_GAMES_AND_TIERS` job per event,
written with the field (the `sync-games-then-tier-field` handler of `SPORT_EVENT_FIELD_SYNCED`,
#1952), so a task that stops after the field still runs them. The job carries the provider's
games and bracket. A finished event queues none. Its stats and warnings below are the job's
result in Activity, not the field sync run's; a job that changed nothing and warned of nothing
leaves no row.

### Participants

| Table | Written |
|---|---|
| `participants` | One per feed id per sport league. A feed id no participant of the event's league is mapped to creates a new participant in that league, whatever the site already holds by that name. |
| `participant_provider_mappings` | The only home of a participant's feed ids (#2040). `provider_id` is the `providers` row. Unique on `(provider_id, external_id, sport_league_id, participant_type)`. Written by the sync, bound by hand, or loaded with test data; no confidence. `last_seen_at` is set on every mapping a field sync matches. |
| `sport_event_participants` | The field row: active, ranking, seed, odds. A released bracket's seeds are kept. |

A participant the site holds by name with no mapping stays beside the new one: merge them, or
bind the feed id on the participant page (`PUT /api/v1/participants/{id}/provider-mappings`).
A feed id the live scores name that no participant of the league is mapped to raises an
`UNMAPPED_PARTICIPANT` sync finding (see *Sync findings* below); its Map participant action binds
it and resolves the finding. A mapping made any other way (the participant page's bind, or a later
roster or field sync creating the participant) resolves it too: each mapping write says
`PARTICIPANT_PROVIDER_MAPPED`, whose handler queues a `RESOLVE_MAPPED_PARTICIPANT_FINDINGS` job (#2069). Participant ids are the provider's raw feed ids in every league, never prefixed (#2040).
The mapping's sport league and participant type keep a team and a player with the same raw id
apart.

**Load sport data is test data only.** It never creates a production participant the sync would
match differently: test rows carry the feed id ([`SPORT-DATA-LOADING.md`](SPORT-DATA-LOADING.md)
*Feed ids*).

### Tiers and prices

While the event is a draft, the field is tiered and priced with no typing
(`SyncedFieldValuationService`): one field order (odds, then seed, then rank, whichever every
participant has, then name to break ties), the event's tiers from its league's tier profile, and prices from
the event's last pricing or the league's pricing profile. Any tier placed by hand freezes tiers
for that event, and any price typed by hand freezes prices (`tiersKeptAsEdited`,
`pricesKeptAsEdited`); later field additions then warn `FIELD_ROWS_UNTIERED` / `UNPRICED`.
Pressing *Auto-assign* is not a hand edit. A released event's tiers and prices are locked. A
field where nobody has odds, a seed or a rank has no order: it is not ordered by name, it is
skipped with reason `NO_ORDER` (#2040). A failure or a skip is a `TIERS_AND_PRICES_NOT_MADE`
warning on the job; the field is written regardless.

### Games and brackets

After each field load, its job's first step, `ProviderGameSlateService.afterFieldLoad`
(`events/provider-game-slate.ts`), turns the provider's games into the event's matches. A game is matched to a stored match by its
two teams. Nothing loads while a team is missing from the field; a refused load is logged, raises
a `GAMES_NOT_SYNCED` finding on the event (resolved once a later load syncs the games), and
never fails the field sync. Spreads stay the admin's. Each round with kickoffs starts at its
earliest one.

| Event status | Effect |
|---|---|
| `DRAFT` | When the provider's pairings or bracket differ (or none is stored), they replace the stored ones through `loadBracket`. Otherwise matches are kept and take the provider's kickoff and home/away. |
| Released, not finished | Pairings stay fixed. Unstarted matches take moved kickoffs. A reseeded round is placed by the server's own reseed when the provider pairs the same teams. Anything else is logged for an admin. |
| `COMPLETED`, `CANCELLED` | Nothing. |

| League | Shape the provider gives |
|---|---|
| NFL weeks, Premier League matchweeks | One round of games. |
| NFL postseason | Full bracket: seeds 1–7 per conference from `/nfl/v1/standings`, 13 matches over four rounds (`toNflPlayoffBracket`). |
| NCAA men's tournament | Full bracket from `/ncaab/v1/bracket`; First Four pairings are play-in places filled by the live-score sync. **Which regions meet in the semifinals is read from `region_id` order, which the vendor does not promise**: check it before a live tournament (`crossRegionPairings` log, `EVENT-SETUP-PROCEDURES.md` *Knockout brackets*). Release the event before the First Four ends. |
| NCAA women's, College Football Playoff | Games only: the women's bracket has no region and the CFP feed has no committee seeds, so an admin builds the bracket and the sync only links games to open matches. |
| NBA, WNBA playoffs | Each series as one game; once the first round is out, a fixed bracket seeded from standings (`series-playoff-bracket.ts`). |
| NHL playoffs | As the NBA, seeded by division from standings points (`toNhlSeedRanks`). |
| MLB postseason | As the NBA, six seeds per league with byes for the top two (`toMlbSeeds`). |
| World Cup knockout | Single games, bracket read back from the final through each match's team sources (`toWorldCupBracket`); third place is left out. |

When standings are refused or don't place the whole first round, the read logs it
(`standingsRefused`, `bracketUnplaced`) and loads games without a bracket. Games without a bracket
never replace a multi-round event's bracket; a draft only takes their kickoffs.

## 4. Triggers, jobs and Activity

| Trigger | Starts | Job / runner |
|---|---|---|
| Schedule, Event list policy | Events sync per synced league | `SYNC_LEAGUE_EVENTS` |
| Root admin **Sync now** | Events sync for one league | `SYNC_LEAGUE_EVENTS` |
| Schedule, participants policy | Field sync | `runConfiguredSportFieldSync` timer, one loop per sport |
| Schedule, live scores policy | Scores sync of every `IN_PROGRESS` event its provider has an id for, with a field | `runConfiguredLiveScoreSweep` timer, lock `ingestion:<sport>:live-scores` |
| Root admin event sync or field refresh | Field or scores for one event | `MANUAL_EVENT_SYNC` |
| BALLDONTLIE webhook | Scores for the notified events | `PROVIDER_EVENT_SYNC` |
| Hourly release sweep | Auto-release check | `RELEASE_SPORT_EVENT` |

Every sync writes a `provider_sync_runs` row with its **kind** (`EVENTS`, `FIELD`, `SCORES`),
its **trigger** (`SCHEDULE`, `WEBHOOK`, `ADMIN`, `COMMISSIONER`, `SYSTEM`; a job's own when a job
ran it), its sport league and event (looked up from the linked event when the caller named
none), and the job that ran it. Its outcome is in columns (#1999): a one-line `summary`, its
numeric `stats`, `changed_count` (rows created, updated or deleted, once it completes) and
`error_count` (at least one on a FAILED run). Who asked is the trigger; nothing else of the
request is kept. The detailed diagnostics (`details_json`) are kept 30 days. Each background job records the same trigger and who started it
("Started by" on screen). The root admin's shared Activity grid (`GET /api/v1/activity`) lists
jobs with their runs, and the Sports, League and Event pages read each league's and event's
latest run per kind for its sync health.

The Field and Scores timers still run outside the job table; moving them onto jobs is the next
step (#1835).

**Overdue.** A released event is `OVERDUE` when it is neither completed nor cancelled more than
4 hours after it should have ended (its last round's end, else its last start plus its league's
provider league's `typicalGameMinutes`). A draft never released is never overdue. One function:
`overdueExpectedEnd` in `packages/shared/domain/event-overdue.ts`.

### Webhooks

`POST /api/v1/provider-webhooks/balldontlie` checks the HMAC-SHA256 signature of
`"{ts}.{raw body}"` (5 minute tolerance; bad or missing → 403), drops unsubscribed leagues and
event types with a 200, and hands the rest to `ProviderNotificationService.receive`. It queues
one `PROVIDER_EVENT_SYNC` per in-progress event the notification is about, 60 seconds out, deduped
on `provider-event-sync:<provider>:<externalId>` so a burst coalesces. A game notification names
its provider league by its event type (`nfl.game.ended`), and is about the in-progress event
whose match holds the game, or, while none does, every in-progress event mapped under that
provider league (#2004); nothing is read off the event's id. The job runs the normal
scores sync. **The delivery is a trigger, never a record**: nothing in its body is written.

Subscribed types are the events `GAME_EVENTS_BY_SET` and `GOLF_EVENT_PHASES` name, by each enabled league row's
webhook event set: `game.started`, `game.period_ended` (`game.halftime` for soccer, `GAME_HALVES`)
and `game.ended` for a game league, and the four PGA tournament and round events for
`GOLF_ROUNDS`.

While the webhook secret is set, polling is only the safety net:

- **Pace.** BALLDONTLIE events poll every `webhookPollMinutes` (15), a golf round every `webhookRoundPollMinutes` (2), both on the Provider row.
- **Start.** A start notification also syncs a linked event still `SCHEDULED` six minutes out,
  after the lifecycle has moved it.
- **Reconcile.** An end notification queues a second sync ten minutes out for late corrections.
- **Quiet alert.** When an event in play hears nothing for longer than its league's
  `quietAfterMinutes` (or 6 hours for a golf round), the sweep logs
  `ingestion.providerNotifications.quiet`, which a CloudWatch alarm forwards.

### Sync findings

`provider_sync_findings` (#1999) is the one list of problems the sync found, shown in root admin at
Manage › Providers › Findings and counted per league, by severity, in the Sports page's Issues
column. Each finding names its sport league; its event, Provider row and the feed's raw value
(`provider_value`) are there when its kind has them.

- **One row per kind and subject.** A NULLS NOT DISTINCT unique index on (kind, league, event,
  Provider, value) dedupes: a finding seen again counts the sighting and takes the new severity.
- **Status.** `OPEN`, `RESOLVED` or `WAIVED` (a waive needs a note, a CHECK constraint). A resolved
  finding the sync sees again opens again; a waived one stays waived.
- **Kinds.** `PROVIDER_RATE_LIMITED` (WARNING after 15 minutes of every call rate limited, ERROR
  at the league's quiet threshold, raised per synced league; resolved by the Provider's next
  answer, *Rate limit and retries* above), `UNMAPPED_PARTICIPANT` (WARNING, raised by the live
  scores writer; its action is the Map participant page) and `WEBHOOK_SECRET_MISSING` (ERROR,
  raised per synced league when a worker task starts with the Provider's webhooks on and no
  signing secret; resolved once it is set, and on a league the Provider no longer syncs at the next check, #2070). Three are checked on an event by each sync that
  could see them, raised as a WARNING when it does and resolved when a later one does not:
  `NO_PROVIDER_PARTICIPANTS` (a completed FIELD run whose provider sent no field),
  `NO_PROVIDER_LIVE_SCORES` (a completed SCORES run with no updates) and `GAMES_NOT_SYNCED` (the
  field's follow-up job could not load the games the provider listed). The ledger turns a feed
  run's warning into its finding, so a run carries no warnings of its own; the tier and price
  warnings stay in the follow-up job's result.
- **Alert.** An ERROR that opens logs `ingestion.syncFinding.errorOpened`; a CloudWatch metric
  filter and alarm (`infrastructure/terraform/monitoring.tf`) send it to the alerts topic.
- **Retention.** The nightly cleanup deletes RESOLVED findings 90 days after they were resolved,
  never an OPEN or WAIVED one: deleting a waiver would let the finding open again.

The actions a finding offers come from the API (`actions` on each finding); the web app draws them.

## 5. Scores sync

```mermaid
sequenceDiagram
  participant S as IngestionScheduler.pollLiveScores
  participant A as BalldontlieAdapter.getLiveScores
  participant P as publishLiveScoreUpdate
  participant F as Scoring family writer
  S->>A: getLiveScores(externalId)
  A->>A: route by scope id to the league reader
  A-->>S: LiveScoreResult {GOLF | GAME}
  S->>P: onLiveScores(result, providerId)
  P->>P: Zod-validate; find event by the provider's id for it (its mapping); skip unless IN_PROGRESS
  P->>F: the event's scoring family's writer, if it accepts the category
  F-->>P: rows + REBUILD_LEADERBOARDS job, one transaction
```

The family is the event's sport league's (`scoringFamilyForEvent`). Finish position (racing) accepts no live scores.

| Category | Writer | Writes |
|---|---|---|
| `GOLF` | `GolfScoreService` | Rounds and standings. Stroke play only. |
| `GAME` | `writeGameScores` | `sport_event_round_matches`: links `external_game_id`, live scores, finals through `MatchResultService.recordResult` (`result_source = PROVIDER`). Postponed games are marked `POSTPONED`. |

**GAME linking.** A single-game round links the game to the one open match between its two
teams; two candidates link nothing until a later sync. A best-of series links no game: the
writer counts each final game's winner and records the result once a side has more than half.
A First Four winner first fills its play-in place. **An admin's result stands**: a different
provider final is logged, not written; clearing the result hands the match back. A level
knockout game takes its winner from the shoot-out.

**Status** is never set by a sync. `EventLifecycleScheduler` (every 5 minutes) moves
`SCHEDULED → IN_PROGRESS → COMPLETED` from the round schedule; settlement and emails follow as
jobs. Scores for an event not yet `IN_PROGRESS` are skipped
(`liveScore.publish.eventNotInProgress`).

## 6. Per league

All files are under `packages/core-api/src/modules/ingestion/adapters/balldontlie/`. Each league
has a vendored OpenAPI document and fixtures under `tests/fixtures/balldontlie/`. The adapter
routes by external id; an id no league claims is read as a PGA TOUR tournament.

| League | Keyword | External id | Participants | Category | Files |
|---|---|---|---|---|---|
| PGA TOUR | `PGA TOUR` | vendor tournament id | bare player id | `GOLF` | `pga-*` |
| NFL | `NFL` | `nfl-<season>-week-<n>`, `nfl-<season>-postseason` | raw team id | `GAME` | `nfl-*` |
| College Football Playoff | `CFP` | `ncaaf-<season>-cfp` | raw team id | `GAME` | `ncaaf-*` |
| NCAA men / women | `NCAAM` / `NCAAW` | `ncaab-<season>-tournament`, `ncaaw-…` | raw team id | `GAME` | `ncaa-tournament-*` |
| NBA / NHL / MLB / WNBA playoffs | `NBA` / `NHL` / `MLB` / `WNBA` | `<league>-<season>-postseason` | raw team id | `GAME`, as series | `<league>-*`, `series-playoffs*.ts` |
| Premier League | `EPL` | `epl-<season>-matchweek-<n>` | raw team id | `GAME` (draws allowed) | `epl-*`, `soccer-contract.ts` |
| FIFA World Cup | `FIFAWC` | `fifa-wc-<year>-knockout` | raw team id | `GAME` with shoot-outs | `fifa-world-cup-*` |

A participant id is the provider's raw feed id, never prefixed (#2040). The same raw id can name a
team in two leagues, or a team and a player in one: the participant's provider mapping tells them
apart, since it is unique on (provider, feed id, sport league, participant type), and its provider
is a `Provider` row. Sync runs and sync jobs name their `Provider` row too, and a run's event is a
link to the `SportEvent` it synced.

League notes that are not obvious from the code:

- **CFP date rule.** College games carry no playoff marker, so the playoff is every game from
  noon UTC the day after conference championship Saturday through January 31
  (`CFP_LEAGUE.window`). The window starts after title games because one can pair two playoff
  teams and would score the wrong match. Swap it for a vendor marker if the paid tier has one.
- **Series playoffs** hand every postseason game over each sync, because the writer counts
  wins from the batch. Readers keep games by the vendor's `postseason` flag for the asked
  season, so every normalizer must read it.
- **Round numbering** (`playoffSeries`): a team's first series is round 1, each later one is one
  past the later of its teams' previous series, which puts MLB's bye teams in round 2.
- **WNBA** has no postseason filter, so the whole season is read. **NHL** places games on
  `game_date`.

### Switched-off leagues

Leagues no provider covers are `is_active = false` by migration, not deleted; bringing one back is
**Activate** on the root admin, or a migration, once it has a source. An inactive league is left
out of How to Play, Contest types, Create contest, event pages and offers, event emails and the
scheduled syncs.

| Switched off | Return ticket |
|---|---|
| Cycling | #682 |
| Running | #683 |
| FIFA Women's World Cup, UEFA Euro, Copa América | #1814 |
| NASCAR, IndyCar | #681 (provider check #1813, deferred) |
| Horse racing | #680 (provider check #1813, deferred) |
| NWSL, PWHL, college hockey, NCAA soccer and tennis | #1815 |

Each return first re-checks BALLDONTLIE's specs before any other provider.

## 7. Reviewing a provider PR

A new league usually touches only these:

1. **Spec and fixtures**: `tests/fixtures/balldontlie/openapi/<league>.yml`, fixtures, and a
   contract test comparing the Zod schemas with the vendor's.
2. **Contract**: `<league>-contract.ts`, Zod schemas for exactly the fields read.
3. **Mapping**: a scope id whose `parse…Scope` cannot claim another league's ids, a prefixed
   participant id, events stamped with the league's `providerLeagueCode`, states through `competition-status.ts`.
4. **Reader**: reads through `BalldontlieClient` only (its call policy's pacing and retries, payload capture). A series
   league supplies a `PlayoffsSource` instead.
5. **Adapter routing**: a branch in `getEventDetails` and `getLiveScores` ahead of the PGA
   fallback, and the league in the `leagues` map.
6. **Migration**: the `provider_league` row (code, sport, webhook event set, `quiet_after_minutes`,
   `typical_game_minutes`) and the sport league's mapping to it; `round_series_lengths` for a
   series league.
7. **Webhooks**: nothing beyond the `provider_league` row: its code is the event type's prefix,
   and its webhook event set says which notifications it takes.
8. **Docs**: this page.

A change to `score-publisher.ts`, the schedulers, the writers or the persistence layer changes
every league, and the PR must say so.

## 8. Open items

- **Unconfirmed webhook names** for college football, NHL, MLB and WNBA (assumed from the NFL's);
  MLB's `quietAfterMinutes` is 210 in case innings are not notified. Confirm during the paid trial
  (#1500).
- **CFP feed**: confirm bowl and playoff games are carried and whether a marker exists (#1500).
- **NCAA semifinal pairing** by `region_id` order: verify against a real bracket.
- **Field and Scores syncs as jobs**, with event-level Sync now (#1835).
- **Per-event tier override** from the event ⚙ dialog is in progress.
- **Not read yet**: UCL two-leg ties, MLS best-of-three.
