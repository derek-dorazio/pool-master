# Background Jobs

A request that starts work it does not wait for hands it to a **background job** (#1439): a row
in `background_jobs`, written in the same transaction as the change that caused it. Any core-api
task claims it, runs it, and retries it on failure; a deploy or a crashed task never loses it.
The code is `packages/core-api/src/modules/background-jobs`.

Which jobs follow which change is declared once, in the domain event handler map
(`DOMAIN_EVENT_HANDLERS`, `modules/domain-events`, #1946): a writer describes its change as a
typed domain event, collects the jobs its handlers ask for, and writes them in its own
transaction (`rules/architecture-rules.md` §4 *Follow-up work is a domain event handler*). The
table under *Domain event handlers* below is generated from the map. Writers not yet moved onto
it (epic #1946) still build their jobs where the table of job types says.

Recurring work (the lifecycle sweep, the automatic event release sweep, each kind of clock-driven email's sweep, the provider loops,
the nightly cleanup, the email sender) stays on its own timer behind a job lock (`rules/architecture-rules.md` §4 *Background jobs run
on one server task*). The job table is for one-off work.

## The job types

| Type | Queued by | Handler | Why a retry is safe |
|---|---|---|---|
| `MANUAL_EVENT_SYNC` | A root admin's event sync (`submitEventSync`, #1441), with the `SUBMITTED` runs in one transaction | `IngestionService.runManualEventSync`: runs each run's feed in turn | It runs only the runs still `SUBMITTED`, so a feed an earlier try started never runs twice; on a retry, a run an earlier try left `IN_PROGRESS` is marked `FAILED` as interrupted (#1445). A feed whose failure could not be written fails the job after the other feeds, so that retry happens. A feed that fails is recorded on its run; the job still succeeds |
| `PROVIDER_EVENT_SYNC` | A verified provider webhook about a game or tournament linked to an in-progress event (`ProviderNotificationService.receive`, #1498): one job per notified event, due about 60 seconds out so a burst coalesces. Payload: the sport, the provider and the event's external id; dedupe key `provider-event-sync:<providerId>:<externalId>` (hashed when too long), released when a worker claims the job | `IngestionScheduler.runNotifiedEventSync`: one live-score sync of the event, recorded as a `WEBHOOK_EVENT_SYNC` run; skipped when the sport is not scheduled or its live scores are off. The flow is in `docs/LIVE-SPORTS-DATA-SYNC.md` | It reads the provider's current scores over REST and writes them through the same writers as the scheduled sweep, so a repeat writes the same state, and nothing from the delivery itself is stored |
| `SYNC_LEAGUE_EVENTS` | A root admin's **Sync now** on a synced sport league (`POST /api/v1/ingestion/sport-leagues/:id/events-sync`, the one asked year or this year and next), and the synced league sweep every 6 hours (`LeagueEventsSync.queueScheduled`, one job per synced league, #1819). Payload: the league and its years (what started it, and the admin, are the job's own, #1861); dedupe key `SYNC_LEAGUE_EVENTS:<sportLeagueId>:<years>`, so a press for another year gets its own job | `LeagueEventsSync.run`: one `EVENTS` sync run per job, created `IN_PROGRESS` with the job's id; for each year it lists the provider's events, creates the new ones and keeps the rest current, writing progress to the run; the run ends `COMPLETED` with what changed, and the job's result carries the counts. A league gone or no longer synced, or a provider refusal that would repeat, is a `PermanentBackgroundJobError` | Creating an event is keyed by the provider and its external id, so a retry updates what an earlier try created; on a retry the run an earlier try left `IN_PROGRESS` is marked `FAILED` as interrupted |
| `CONTEST_STARTED_EMAILS` | Each contest that goes live (the `tell-league-contest-started` handler of `CONTEST_STATUS_CHANGED`, as `EventLifecycleService` moves it through `ContestLifecycle`, #1387, #1949), with its move to `ACTIVE`. Payload: the contest and the event that started it; dedupe key `CONTEST_STARTED_EMAILS:<contestId>` | `ContestEmailJobs.contestStarted`: reads the contest and event again and queues "Contest is live" (E1) to the league | Each email's outbox idempotency key is the contest, the event and the person, so a retry queues only what an earlier try did not |
| `CONTEST_SETTLED_EMAILS` | Each contest that completes (the `tell-league-contest-settled` handler of `CONTEST_STATUS_CHANGED`, as `ContestSettlementService` moves it through `ContestLifecycle`, #1387, #1949), with its move to `COMPLETED`. Payload: the contest; dedupe key `CONTEST_SETTLED_EMAILS:<contestId>` | `ContestEmailJobs.contestSettled`: reads the final places frozen at settlement and queues "Final results" (F1 to F3); a contest no longer completed is skipped | As above, keyed by the contest and the person |
| `CONTEST_REOPENED_EMAILS` | Each live contest a postponement takes back to `OPEN` while its event's start is ahead (the `tell-league-contest-reopened` handler of `CONTEST_STATUS_CHANGED`, as `EventLifecycleService.followPostponedStart` moves it from the `FOLLOW_POSTPONED_EVENT_CONTESTS` job or the lifecycle sweep through `ContestLifecycle`, #1808, #1949), with its move. Payload: the contest, the event and the start the reopen set; dedupe key `CONTEST_REOPENED_EMAILS:<contestId>:<sportEventId>:reopened-<start>` | `ContestEmailJobs.contestReopened`: reads the contest and event again and queues "Event postponed, picks are open again" to the league, the only email those contests get for the change (#1910); a contest no longer open to that start, or gone, is skipped | Keyed by the contest, the event, the start and the person, so a retry queues only what an earlier try did not |
| `CONTEST_EVENT_CHANGED_EMAILS` | Each open or live contest on an event that is postponed, moved or cancelled (`ContestNotices.sportEventChangedJobs`, #1458). A postponement, a cancellation or a moved start writes them, through the `tell-leagues-event-postponed`, `tell-leagues-event-cancelled` and `tell-leagues-event-rescheduled` handlers, in the same transaction as the event's change (#1464, #1951), so a change that fails or loses a race queues none and one that lands always has them; a cancellation's are written while its contests are still open, before its settle job finishes them. Payload: the contest, the event, the change and the event's start as it left it (and the old start of a move); dedupe key `CONTEST_EVENT_CHANGED_EMAILS:<contestId>:<change>` | `ContestEmailJobs.contestEventChanged`: reads the contest and event again and queues C6 or C7 to its commissioners and entrants, whatever the contest's status now (a cancellation's job may run after settlement); a contest or event gone is skipped | Keyed by the contest, the change and the person, as above |
| `SETTLE_SPORT_EVENT_CONTESTS` | An event's move to `COMPLETED` or `CANCELLED` (the `settle-finished-event-contests` handler of `SPORT_EVENT_STATUS_CHANGED`, #1448), in the same write as the status change, so a lost race queues nothing. Payload: the event and the time its contests settle at (its end, or the cancellation); dedupe key `SETTLE_SPORT_EVENT_CONTESTS:<sportEventId>` | `EventLifecycleService.settleFinishedEventContests`: reads the event again (one no longer finished is skipped), takes a completed event's contests still open past their cutoff live first, as `ACTIVATE_EVENT_CONTESTS` would, so an event that completed before that job ran still sends "Contest is live" (#1952), then settles each of its contests through `ContestSettlementService`; a cancellation's "event cancelled" email jobs (C7) were written with the cancellation | Each contest settles in its own write and leaves `COMPLETED`, so a retry settles only the contests an earlier try did not |
| `SETTLE_GAME_CONTESTS` | A game decided by `MatchResultService` (#1460), an admin's or a provider's result alike (#1954): its result saved, a quarter score entered after its result, or the game cancelled. The `GAME_DECIDED` domain event's handler, written in the same transaction as the match write. Payload: the event, the game and the moment it was decided; dedupe key `SETTLE_GAME_CONTESTS:<sportEventRoundMatchId>` | `EventLifecycleService.settleFinishedGameContests`: settles the squares contests on the game through `ContestSettlementService.settleFinishedGame`, from the game as it stands when the job runs | A contest already `COMPLETED` is skipped, and a contest's winners and standings are replaced in place, so a retry settles only the contests an earlier try did not finish |
| `REBUILD_LEADERBOARDS` | Any write that changes what live leaderboards are computed from (#1463), through `JobLeaderboardRebuilds`: an admin's event write (scores, field, status), a provider sync, live scores, a pick'em or survivor week submitted or sent back, and a settlement (one job for the settled event, however many contests it settled). One job per event or contest named. An admin's event write (a score, result, bracket, field, start or status change), a provider sync that changes a field row and a live-score tick (with its last write, the ranks) write their event's job in the same transaction as the change (the `SPORT_EVENT_RESULTS_CHANGED` and `GAME_DECIDED` domain events' handlers, #1466, #1948), and a pick'em or survivor week submitted or sent back to draft writes its contest's job with the week (the `CONTEST_ENTRY_EVENT_STATUS_CHANGED` domain event's `rebuild-contest-leaderboards` handler, #1950), so a write that fails queues none and one whose job fails to insert is rolled back and answers an error. A field sync that changes no row writes none. A settlement writes its event's job (the `SPORT_EVENT_RESULTS_CHANGED` handler's) with each contest's frozen event standings, in that write's transaction, changed rows or not, and wakes the runner once its contests are settled (#1973); a squares grid's standings carry none, since a squares contest stores no board. Every contest status move (going live, reopening, completing, opening a draft) writes that contest's job with the move (the `CONTEST_STATUS_CHANGED` domain event's `rebuild-moved-contest-leaderboards` handler, #1973), so a contest's board never keeps a status or totals from before it went Final, including one completed with no standings rows (a cancelled event's). Payload: the subject (`EVENT` or `CONTEST`) and its id; dedupe key `REBUILD_LEADERBOARDS:<subject>:<id>`, so a burst of writes to one event waits as one job, and a write made while it runs queues one more | `ContestService.rebuildLeaderboardSnapshots`: rebuilds every stored board of the contests on the event, or of the one contest, from the data as it stands when the job runs | A rebuild only stores a board computed from newer data than the stored one, so a repeated rebuild changes nothing a viewer sees; a board left stale by a failed rebuild is still caught by a read (`isSnapshotCurrent`) |
| `RELEASE_SPORT_EVENT` | The hourly automatic release sweep (`SportEventAutoReleaseScheduler`, #1823): one job per synced DRAFT event inside its sport league's `autoReleaseDaysBeforeStart` window, in one insert. Payload: the event and the trigger (`SCHEDULE`); dedupe key `RELEASE_SPORT_EVENT:<sportEventId>`, so a sweep that finds the event again before its job runs queues nothing | `SportEventService.autoReleaseEvent`: reads the event again; one no longer a synced draft in its window is skipped. Judges every ready check; all passing releases it through the manual button's path, any failing holds it as a draft for the next sweep. Either way the event keeps that check as its latest (when, `RELEASED` or `HELD`, and the failed checks, #1847), which the Sports page counts. A hold for exactly the failed checks the stored one already names discards the job (#1865), so a draft held all week shows in Activity once, then again only when what holds it changes or it is released. Its result, kept on the job and shown in Activity under the Release kind, is the outcome with every check and its value, or why it was skipped | A released event is skipped as `NOT_DRAFT`, so a retry never releases twice; a held attempt changes nothing but its stored check, which the retry overwrites |
| `SYNC_EVENT_GAMES_AND_TIERS` | A provider field sync of an event not finished (the `sync-games-then-tier-field` handler of `SPORT_EVENT_FIELD_SYNCED`, #1952), in the same transaction as the field rows it writes, or on its own when no row changed (the provider's games may have). Payload: the event, the provider and its event id, and the provider's games and bracket that came with the field, kickoffs as ISO instants; dedupe key `SYNC_EVENT_GAMES_AND_TIERS:<sportEventId>`, so a second sync before it runs queues nothing and the waiting job syncs the first sync's games (the next sync after it is claimed takes any change) | `SyncedFieldFollowUps.run`: the provider's games first (`ProviderGameSlateService.afterFieldLoad`), then the draft's tiers and prices (`SyncedFieldValuationService.afterFieldLoad`). A step that fails is logged, not thrown: the field is written and the next sync tries again. Listed games that fail to load raise a `GAMES_NOT_SYNCED` finding on the event, which a later load that syncs them resolves (#1999); a tiering or pricing failure is a `TIERS_AND_PRICES_NOT_MADE` warning in the job's result. Its result is the games outcome and the tier and price stats and warnings; a run that changed nothing, failed nothing and warned of nothing is discarded (#1865) | Each step reads the event as it stands and writes only what differs from the stored games, tiers and prices, so a retry changes nothing an earlier try already wrote; a hand-placed tier or typed price is kept |
| `ACTIVATE_EVENT_CONTESTS` | An event's move to `IN_PROGRESS` (the `activate-event-contests` handler of `SPORT_EVENT_STATUS_CHANGED`, #1952), in the same transaction as the status. Payload: the event; dedupe key `ACTIVATE_EVENT_CONTESTS:<sportEventId>`, so a second start before it runs queues nothing | `EventLifecycleService.activateEventContests`: reads the event again and, while it is `IN_PROGRESS` or `COMPLETED`, takes each `OPEN` contest past its cutoff live through `ContestLifecycle` (whose handlers queue "Contest is live"); an event no longer started is skipped. The lifecycle sweep asks the same of every event in progress, as the backstop | Each move is a guarded status change, so a retry finds nothing left to start |
| `FOLLOW_POSTPONED_EVENT_CONTESTS` | An event's move to `POSTPONED` (the `follow-postponed-event-contests` handler of `SPORT_EVENT_STATUS_CHANGED`, #1952), in the same transaction as the status. Payload: the event; dedupe key `FOLLOW_POSTPONED_EVENT_CONTESTS:<sportEventId>` | `EventLifecycleService.followPostponedEventContests`: reads the event again and, while it is `POSTPONED`, reopens its live contests while its start is ahead or starts them once it has passed (#1792), planned from the event as it then stands; an event no longer postponed is skipped. The lifecycle sweep asks the same of every postponed event, as the backstop | Each move is a guarded status change, so a retry finds nothing left to move |
| `RESOLVE_MAPPED_PARTICIPANT_FINDINGS` | A write that maps feed ids to participants (the `resolve-mapped-participant-findings` handler of `PARTICIPANT_PROVIDER_MAPPED`, #2069): the participant page's bind, or a roster or field sync creating participants, in the same transaction as the mappings. Payload: the sport league, the Provider row and the feed ids mapped | `ProviderSyncFindingService.resolveMappedParticipants`: the league's OPEN `UNMAPPED_PARTICIPANT` findings of those feed ids resolve, in one statement. A run that resolved none is discarded (#1865) | Resolving an already resolved finding changes nothing, so a retry is safe |

## Domain event handlers

What follows each change, as the map declares it: each handler, in the order its jobs are
collected, and the job types it may queue. A handler only collects jobs (it may read, never
write); its `when` filters on the event's own model fields. An event type with no handler says
so on purpose.

<!-- domain-event-handlers:start (generated from DOMAIN_EVENT_HANDLERS by `npm run docs:domain-events`; edit the map, not this table) -->
| Domain event | Handler | Queues |
|---|---|---|
| `SPORT_EVENT_STATUS_CHANGED` | `activate-event-contests` | `ACTIVATE_EVENT_CONTESTS` |
| `SPORT_EVENT_STATUS_CHANGED` | `follow-postponed-event-contests` | `FOLLOW_POSTPONED_EVENT_CONTESTS` |
| `SPORT_EVENT_STATUS_CHANGED` | `settle-finished-event-contests` | `SETTLE_SPORT_EVENT_CONTESTS` |
| `SPORT_EVENT_STATUS_CHANGED` | `tell-leagues-event-postponed` | `CONTEST_EVENT_CHANGED_EMAILS` |
| `SPORT_EVENT_STATUS_CHANGED` | `tell-leagues-event-cancelled` | `CONTEST_EVENT_CHANGED_EMAILS` |
| `SPORT_EVENT_STATUS_CHANGED` | `rebuild-event-leaderboards` | `REBUILD_LEADERBOARDS` |
| `SPORT_EVENT_RESCHEDULED` | `tell-leagues-event-rescheduled` | `CONTEST_EVENT_CHANGED_EMAILS` |
| `SPORT_EVENT_RESULTS_CHANGED` | `rebuild-leaderboards-for-changed-results` | `REBUILD_LEADERBOARDS` |
| `SPORT_EVENT_GAMES_CHANGED` | `refresh-slot-tiebreakers` | `REFRESH_SLOT_TIEBREAKERS` |
| `GAME_DECIDED` | `settle-decided-game-contests` | `SETTLE_GAME_CONTESTS` |
| `GAME_DECIDED` | `rebuild-leaderboards-for-decided-game` | `REBUILD_LEADERBOARDS` |
| `GAME_DECIDED` | `refresh-slot-tiebreakers-for-decided-game` | `REFRESH_SLOT_TIEBREAKERS` |
| `CONTEST_ENTRY_EVENT_STATUS_CHANGED` | `rebuild-contest-leaderboards` | `REBUILD_LEADERBOARDS` |
| `CONTEST_STATUS_CHANGED` | `tell-league-contest-started` | `CONTEST_STARTED_EMAILS` |
| `CONTEST_STATUS_CHANGED` | `tell-league-contest-reopened` | `CONTEST_REOPENED_EMAILS` |
| `CONTEST_STATUS_CHANGED` | `tell-league-contest-settled` | `CONTEST_SETTLED_EMAILS` |
| `CONTEST_STATUS_CHANGED` | `rebuild-moved-contest-leaderboards` | `REBUILD_LEADERBOARDS` |
| `SPORT_EVENT_FIELD_SYNCED` | `sync-games-then-tier-field` | `SYNC_EVENT_GAMES_AND_TIERS` |
| `PARTICIPANT_PROVIDER_MAPPED` | `resolve-mapped-participant-findings` | `RESOLVE_MAPPED_PARTICIPANT_FINDINGS` |
<!-- domain-event-handlers:end -->

Adding a follow-up to a change: a handler beside its job's builder in the module that owns the
job, listed under its event type in `DOMAIN_EVENT_HANDLERS`, its unit test (event in, job
requests out, none when `when` says no), the pinned map in `domain-event-handlers.test.ts`, and
`npm run docs:domain-events`. `poolmaster/follow-ups-via-domain-events` (ESLint) refuses a job or a
board rebuild queued anywhere else; an entry point that starts work rather than reacting to a
change (a webhook, an admin's route, a sweep on a timer) says so with
`// poolmaster-allow-direct-job: <what starts the work>` at the call. A new kind of change is a member of `DomainEvent` and a value of
`DomainEventType`; the map is exhaustive over it, so a type without an entry fails typecheck.

Adding a type: a value in `BackgroundJobType` (domain enum and Prisma enum, by migration), its
payload schema in `BACKGROUND_JOB_PAYLOADS`, its scope in `BACKGROUND_JOB_SCOPES`, its kind in
`BACKGROUND_JOB_KINDS`, and its handler where index.ts builds the runner. Every registry is
exhaustive over the enum, so a type missing one fails typecheck. Say in the table above how the
handler is idempotent.

## Kind, scope and result (#1819)

- **Kind** (`SYNC`, `EMAIL`, `SETTLEMENT`, `RELEASE`, `OTHER`) groups the types for Activity. It
  is derived from the type (`BACKGROUND_JOB_KINDS`) and never stored, so moving a type to
  another kind needs no migration.
- **Scope**: the queue fills `sport_league_id` and `sport_event_id` from the payload
  (`BACKGROUND_JOB_SCOPES`) when the job is built. An event's job names only its event; a
  league's Activity reads its events' ids first and takes their jobs too, so no insert pays a
  lookup. The columns carry no foreign keys: a job outlives a deleted event as a record.
- **Result**: a handler may return a small JSON object, stored on the job when it succeeds
  (the league events sync returns its run's id and counts).
- A handler throws `PermanentBackgroundJobError` for a failure every try would repeat; the job
  is `FAILED` at once, with no retry.

## Trigger and outcome (#1861)

- **Trigger**: every job records what started it, `SCHEDULE`, `WEBHOOK`, `ADMIN`,
  `COMMISSIONER` or `SYSTEM`, and for `ADMIN` and `COMMISSIONER` the person
  (`started_by_user_id`). The queue reads it from the entry point's scope (`core/job-start.ts`):
  a timed sweep and the sync scheduler open `SCHEDULE`, the webhook receiver passes `WEBHOOK`,
  the runner opens `SYSTEM` around each handler, and a request records the role its route
  requires (the root admin guard `ADMIN`, a commissioner gate `COMMISSIONER`, even for a root
  admin) or `SYSTEM` for upkeep a member's request asks for. A job queued outside any of them
  throws `JobStartMissingError`. A member's own action never queues a job of its own
  (`rules/architecture-rules.md` §4 *Service Topology*). A sync run records its job's trigger.
- **Changed count**: each handler returns `{ changedCount }`, the rows it created or changed
  (emails queued, events created or updated, contests settled, boards written); null on a job
  that has not succeeded.
- **Error type** (`JobErrorType`): set with the error on a retry or failure (`RATE_LIMITED` for a
  provider's 429, `TIMEOUT` for an aborted request or lapsed leases, `PROVIDER_ERROR` for another
  provider error status or refusal, `BAD_DATA` for a payload or response that broke its schema,
  `OTHER` otherwise), and `CHECK_FAILED` on a succeeded job a check held back (a release hold, a
  contest whose rules refused an added event).
- **Duration**: `started_at` is set when a try is claimed; Activity answers `durationSeconds`
  from it to `completed_at`.
## Activity

`GET /api/v1/activity` (root admin) lists jobs newest first, narrowed by kind, status, league or
event, each with the ids of the sync runs it recorded, its trigger and starter (`startedBy`, with
a display name, read in one batched query), changed count, error type and duration, and the names
of the sport league and event it is about (`sportLeague`, `sportEvent`; a job on an event takes
its event's league), read in one batched query each (#1887). Sync now's 202 answers its job the
same way. There is no paging: the read is bounded
by its window instead, `from` to `to`, which defaults to the last 24 hours, or the whole 30 days
kept when a league or event narrows it; a `from` after `to` answers 400 `ACTIVITY_WINDOW_INVALID`. One address may read it 60 times a minute (`@fastify/rate-limit` on this route only, per process); more answer 429 `ACTIVITY_RATE_LIMITED`. It costs the same statements for any number of jobs
(pinned in `root-admin-route-query-scaling.integration.ts`).

The web shows it in one shared grid, `ActivityGrid` (`clients/poolmaster/src/features/root-admin`,
#1887): the root admin Activity page (`/manage/activity`) unscoped, and a sport league's and an
event's Activity tabs scoped to theirs. It opens on Started over the past day and asks the server
for the window its Started filter covers, so widening the filter reads further back; with the
filter cleared it reads all 30 days. Each code (kind, type, status, trigger, error type) reads as
words mapped in `activity-labels.ts`, never derived from the enum's name. The old sync run history
page at `/manage/sync` is gone; its links redirect to Activity, and Run event sync moved under
`/manage/providers`; the old Unmapped participants page is now the Findings list there (#1999).

## Queueing

`BackgroundJobQueue` checks the payload against its type's schema before anything is written,
so a bad payload fails in the request that made it.

- A job with a cause written elsewhere: `request(type, payload)` builds it, the adapter writing
  the cause writes it in its transaction (`insertBackgroundJobs(tx, …)`), and the caller calls
  `queued()` after the commit. `ProviderSyncRunRepository.createWithJob` is the model; a
  contest's status move takes its jobs as `ContestStatusTransition.jobs`, given the contests
  that moved.
- A job on its own: `enqueue(type, payload)`; many with no other write, such as one per contest
  on an event, in one insert: `enqueueAll(requests)`, each built with `request`.

Either way the queue wakes this task's runner when it runs one (see *Running*), so on an idle
system the job starts at once; on an `api` task the job waits for a worker's poll, within
`BACKGROUND_JOB_POLL_MS`.

A `dedupeKey` keeps one job waiting for its first try per subject: an enqueue with a key such a
job holds writes nothing. Claiming a job clears its key for good, so a request made while it runs,
or while it waits to be retried, queues a fresh one.

## Running

Which core-api tasks run the runner is their role, `CORE_API_ROLE` (#1186):

| Role | Serves requests | Runs the background work | A queued email or job |
|---|---|---|---|
| `all` (unset; QA and local dev) | yes | yes | wakes this task's sender or runner |
| `api` | yes | no | waits for a worker's poll |
| `worker` | yes, but behind no load balancer: only health checks reach it | yes | from its own work, wakes it; from an API task, found by its poll |

The background work is the job runner, the email sender, the event lifecycle sweep, the
clock-driven email sweeps (one per kind, `DueNotificationsScheduler`), nightly cleanup and provider
ingestion (still also gated by `AUTO_START_SCHEDULER`). A worker's email
sender polls every second rather than every 15, since an API task's email never wakes it; a job
an API task queued waits for the worker's job poll, at most `BACKGROUND_JOB_POLL_MS`. An
unknown role stops the task at startup. The advisory job locks (#1159) hold in every role, so
old and new workers overlapping in a deploy run each scheduled job once. No environment runs
`api` or `worker` yet: the worker's ECS service is not in Terraform.

The runner polls every `BACKGROUND_JOB_POLL_MS` (default 10000, #1446) and on each wake. It runs at
most 2 jobs at a time, and each slot claims its next due job with `FOR UPDATE SKIP LOCKED` as
soon as its last one finishes, so one slow job never holds up the jobs behind it (#1447). Each
job runs outside any request: its own reads, no request query budget.

| What happens | The job becomes |
|---|---|
| Claimed | `RUNNING`, one more attempt, leased for 5 minutes |
| The handler finishes | `SUCCEEDED`, with its changed count and its result if it returned one |
| The handler returns `DISCARD_BACKGROUND_JOB` | deleted, fenced to this attempt like every mark: the try did nothing worth a row in Activity (#1865) |
| The handler throws | `QUEUED` again, due 1, 5 then 30 minutes later; on the fourth failure, `FAILED` |
| Its stored payload fails its schema | `FAILED` at once: every try would fail alike |
| The handler throws `PermanentBackgroundJobError` | `FAILED` at once |
| The handler throws an error that asks to run later (`deferUntil`, such as a provider's `ProviderRateLimitedError`) | `QUEUED` again, due then, with the attempt handed back: the try never counts toward its four, and its error and type stay for Activity |
| Its task stops mid-run | still `RUNNING` until the lease ends, then due again on any task |
| Its leases lapsed on every try | `FAILED` |
| A try outlives its lease and another task claims it | the newer attempt's outcome: each mark is fenced to the attempt that claimed it, so the late one writes nothing |

A handler whose work can outlast one lease calls `context.renewLease()` between steps: the
claim is held for another lease from now, fenced to this attempt, and `false` means another task
has claimed the job, so the try stops (the league events sync renews before each year, since a
provider's rate limit can hold one year's reads for minutes).

On shutdown a task stops claiming and gives its jobs in flight 10 seconds; anything still running
is re-run once its lease ends.

## Logs

Every line carries `action` and the job's id, type and attempt (`docs/LOGGING-OPERATIONS.md`).

| `action` | Level | Meaning |
|---|---|---|
| `backgroundJobs.succeeded` | info | Done, with its `durationMs` |
| `backgroundJobs.retry` | warn | Failed; tried again in `retryInMs` |
| `backgroundJobs.failed` | error | Failed its last try. This is the alert: look at the job's `last_error` |
| `backgroundJobs.invalidPayload` | error | Its payload failed its schema; it never ran |
| `backgroundJobs.abandoned` | error | Its leases kept lapsing |
| `backgroundJobs.claimLost` | warn | A try outran its lease and the job was claimed again; this try's outcome was not written, the newer attempt's stands |
| `backgroundJobs.runner.failure` | error | A claim or a write failed; the next poll tries again |

## Retention

The nightly cleanup deletes every finished job, `SUCCEEDED` or `FAILED`, 30 days after it
finishes (`BackgroundJobRetention`), so Activity reaches back the same 30 days for both.

## Testing

Tests drive the real runner, never a "run inline" branch (`rules/testing-rules.md` §1B
*Forbidden Application-Code Patterns*). Unit tests use the in-memory job table in
`tests/support/in-memory-background-jobs.ts` with an injected clock and call `drain()`. The
integration app's runner has no timer: a queued job wakes it, as in the app
(`integrationBackgroundJobs` in `tests/integration/helpers.ts`). `deliverQueuedIntegrationEmail`
drains the app's jobs first, and `holdingBackgroundJobs` holds them back while a test counts a
request's own statements. Functional tests wait on the outcome, such as a sync run's status.

## Scaling out (deferred)

Not built, and none of it changes the handler map: `background_jobs` is already a transactional
outbox and a queue (rows written with the change, claimed with `FOR UPDATE SKIP LOCKED`, leases,
retries, dedupe keys), and `core/task-role.ts` already has the `api`, `worker` and all-in-one
roles. Each step waits for its trigger (design: epic #1946).

1. A separate worker service, the `worker` role as its own ECS service scaled on queue depth:
   when job work slows API requests, or one worker can't keep up.
2. A cross-task wake (Postgres `LISTEN/NOTIFY` on commit): when the 10-second poll delay is
   noticeable to members.
3. Lanes, one per job kind with its own concurrency in the same table: when one kind starves
   another.
4. An outbox relay to SQS, one queue per lane, workers still recording the outcome: when claim
   polling becomes real database load.
5. EventBridge, each domain event published for a second deployable service to subscribe to:
   only when such a service exists.

What keeps each step cheap: never publish to a queue from a request (the outbox row is what
makes a relay safe), keep every handler idempotent and every job deduped (SQS and EventBridge
deliver at least once), keep domain events additive, and keep payloads to ids and from/to
values.
