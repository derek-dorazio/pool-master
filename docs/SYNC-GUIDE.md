# PoolMaster Sync Guide

This guide explains what each PoolMaster sync does, what it returns, how the
lookahead windows affect event and participant availability, and when live score
polling begins.

Current implementation references:

- Scheduler: `packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts`
- Provider contract: `packages/core-api/src/modules/ingestion/core/provider-interface.ts`
- Event candidate reader: `packages/core-api/src/modules/ingestion/core/scheduled-event-reader.ts`
- Persistence: `packages/core-api/src/modules/ingestion/persistence/ingestion-persistence.ts`
- Mock provider scenario store: `packages/mock-contest-feed-provider/src/scenario-store.ts`

## Sync Entry Points

There are three ways sync work runs.

| Entry point | Who starts it | What it returns |
|---|---|---|
| Scheduled scheduler | Core API `onReady`, unless `AUTO_START_SCHEDULER=false` | Persists an `ingestion_jobs` row and logs an `IngestionJobRecord` for each completed job. |
| Root-admin manual sync pages | Root-admin manage UI through admin provider service | Immediately creates `provider_sync_runs` as `SUBMITTED`, then runs each feed asynchronously and updates each run to `IN_PROGRESS`, `COMPLETED`, or `FAILED`. |
| Direct ingestion API routes | `/api/v1/ingestion/*` admin routes | Synchronously returns `{ job }` or `{ jobs }` with scheduler job records. |

Manual sport syncs can request only sport-level feeds, and the requested sport
must be present in `scheduledSports`:

- `EVENTSCHEDULE`
- `EVENTPARTICIPANTS`
- `PARTICIPANTRANKINGS`

Manual event syncs can request only event-level feeds, and the requested sport
must be present in `scheduledSports`:

- `EVENTPARTICIPANTS`
- `EVENTLIVESCORES`
- `EVENTRESULTS`

`EVENTPARTICIPANTS` appears in both manual sync sets because it is the same
field-hydration feed at two different scopes. Sport-level participant sync
discovers eligible events in the participant lead window and hydrates each one.
Event-level participant sync skips discovery and hydrates only the requested
event ID.

## Default Schedule Configuration

The default global ingestion schedule is:

| Config field | Default |
|---|---|
| `scheduledSports` | `["GOLF"]` |

| Feed | Default cadence | Default window |
|---|---:|---|
| Health check | 5 minutes | No event window |
| Event schedule | 360 minutes | `now` through `now + 30 days` |
| Event participants | 720 minutes | `now` through `now + 7 days` |
| Participant rankings | 1440 minutes | No event window |
| Event live scores | 30 seconds | Persisted events with status `IN_PROGRESS` |
| Event results | 30 minutes | Persisted events with status `COMPLETED` or `OFFICIAL`, updated in the last 24 hours |

Root-admin schedule config can override `scheduledSports` globally and feed
cadence/window settings globally or per sport. The scheduler starts automatic
sport loops only for sports listed in `scheduledSports` and backed by a
registered provider. It reconciles the configured sport set periodically, so
adding a sport can start its loops without a redeploy; removing a sport causes
existing loops to skip provider calls. Per-sport feed settings are read at each
tick, so changing cadence or windows does not require a redeploy.

## What Each Sync Does

### Health Check

Calls `provider.healthCheck()` for every registered provider and updates the
in-memory provider registry health report.

It does not import events, participants, rankings, scores, or results.

### Event Schedule Sync

Calls:

```text
provider.getUpcomingEvents(sport, { from, to })
```

Scheduled range:

```text
from = now
to = now + eventSchedule.lookaheadDays
```

If no manual `from`/`to` is supplied, direct sport sync falls back to
`now..now+14 days`.

The mock adapter returns events whose provider `startDate` is inside the range,
inclusive. Core API then upserts `sport_events` by `(providerId, externalId)`.
The event status is whatever the provider returned after adapter mapping:

| Mock provider status | Core API sport event status |
|---|---|
| `scheduled` | `SCHEDULED` |
| `field_announced` | `SCHEDULED` |
| `in_progress` | `IN_PROGRESS` |
| `completed` / `corrected` | `COMPLETED` |

Job `recordsProcessed` is the number of provider events returned.

### Event Participant Sync

Sport-level participant sync calls:

```text
provider.getUpcomingEvents(sport, { from, to })
provider.getEventDetails(event.externalId)
```

Scheduled range:

```text
from = now
to = now + max(eventSchedule.lookaheadDays, eventParticipants.leadDaysBeforeStart)
```

If `eventSchedule.lookaheadDays` is not configured, scheduled participant sync
uses `30`. If `leadDaysBeforeStart` is not configured, it uses `7`.

After the future-window sweep, scheduled participant sync also asks PoolMaster
for persisted `IN_PROGRESS` sport events for the same sport/provider and runs
event-level participant hydration for each one. This keeps fields refreshed for
active/live events whose start time is already in the past.

For each hydrated event detail, Core API persists:

- the `sport_events` row
- normalized `participants`
- provider mappings in `participant_provider_mappings`
- event field rows in `sport_event_participants`
- raw event participant snapshots in `sport_event_participant_source_data`

Sport-level job `recordsProcessed` is the number of events hydrated. The logs
also include `participantsReturned`.

Event-level participant sync skips the discovery window and calls
`provider.getEventDetails(eventId)` directly. Its `recordsProcessed` is the
participant count for that one event. If the provider cannot resolve the event
ID, the event-level participant sync fails.

### Participant Ranking Sync

Calls:

```text
provider.getRankings(sport, 'default')
```

There is no event date window. Rankings are persisted onto
`participant_season_records` when the participant already has a provider mapping.
Unknown participants are skipped until participant sync has created mappings.

Job `recordsProcessed` is the number of rankings returned by the provider.

### Event Live Score Sync

Scheduled live score sync does not use a lookahead window. It asks the scheduled
event reader for persisted event IDs where:

```text
sport = requested sport
providerId = active provider for the sport
status IN ('IN_PROGRESS')
externalId is not empty
```

Then it calls:

```text
provider.getLiveScores(eventExternalId)
```

Live scores are not persisted as sport-event rows. They are transformed into
`stat.received` events and published to the in-process event bus. The stat event
consumer recalculates contests that have roster picks for the affected
participant and whose contest status is `LOCKED` or `ACTIVE`.

Job `recordsProcessed` is the number of stat events returned by the provider.

### Event Results Sync

Scheduled result sync reads persisted events where:

```text
sport = requested sport
providerId = active provider for the sport
status IN ('COMPLETED', 'OFFICIAL')
updatedAt >= now - 24 hours
externalId is not empty
```

Then it calls:

```text
provider.getEventResults(eventExternalId)
```

Results are converted into `FINISH_POSITION` stat events and published through
the same scoring path as live scores.

Job `recordsProcessed` is the number of result rows returned. If the provider
returns no results, the job completes with `0` records.

## Event Readiness And Contest Creation

Sport event readiness is computed at read/create time from:

- `releaseAt`
- `fieldLocksAt`
- loaded participant count
- provider `fieldLocked`

The readiness states are:

| Readiness state | Meaning |
|---|---|
| `NOT_RELEASED` | Current time is before `releaseAt`. |
| `PENDING_FIELD` | Event is released, but no participants are loaded. |
| `CONTEST_ELIGIBLE` | Event is released, participants are loaded, and the field is not locked. |
| `FIELD_LOCKED` | Provider says the field is locked, or current time is at/after `fieldLocksAt`. |

Commissioner contest creation requires `CONTEST_ELIGIBLE`. It is blocked before
release, before the field is loaded, and after the field locks.

Timing is resolved when events are persisted. Provider metadata `releaseAt` and
`fieldLocksAt` values are honored when present. If a provider does not return
explicit event timing, contest timing policies remain the fallback.

## When An Event Becomes In Progress

Core API does not currently promote a sport event to `IN_PROGRESS` just because
`startDate` has passed.

An event becomes `IN_PROGRESS` in PoolMaster when a schedule or participant sync
persists a provider payload whose mapped event status is `IN_PROGRESS`.

That means live score polling starts only after both of these are true:

1. A schedule or participant sync has persisted the event as `IN_PROGRESS`.
2. The scheduled live-score sweep runs and finds that persisted event for the
   active provider.

Manual event live-score sync can call the provider directly for a specific
event ID, but the scheduled 30-second live-score loop only polls persisted
`IN_PROGRESS` events.

## Mock Golf Relative Today Dataset

The mock contest feed provider always includes a generated `golf-relative-today`
scenario unless explicitly disabled in tests. It is anchored to the current UTC
day and is meant to keep QA data available across the event lifecycle.

Default assumptions for this table:

- event schedule lookahead: `30` days
- participant lead window: `7` days
- live-score interval: `30` seconds
- exact scheduler windows are timestamp-based, not whole-calendar-day based

| Event ID | Provider state | Provider timing | Schedule sync | Participant sync | Intended contest creation window | Scheduled live scores |
|---|---|---|---|---|---|---|
| `golf-relative-manual-test-<startDateTime>` | dynamic | Named `Manual Test Golf Tournament for <startDateTime>`; mock-clock anchored: 20 minutes contest-eligible/open, 20 minutes field locked, 20 minutes `in_progress`, 20 minutes `completed`, then the next provider call starts a new cycle | Included while start is in `now..now+30d` | Included while start is in `now..now+30d`; active persisted events are also refreshed after they become `IN_PROGRESS` | Eligible during the first 20 minutes of each cycle, blocked once the field-lock phase begins | Yes, after a sync persists the event as `IN_PROGRESS`; returns 80 deterministic randomized golf score stats during the 20-minute live window |
| `golf-relative-locked-tomorrow` | `field_announced` | Starts tomorrow at 12:00 UTC; lock was 1 hour ago | Included | Included | Blocked because field is locked | No, because persisted status maps to `SCHEDULED` |
| `golf-relative-ready-5d` | `field_announced` | Starts at 12:00 UTC about 5 days out; released yesterday; locks about 1 day before start | Included | Included | Eligible after participants are loaded and until lock time | No, because persisted status maps to `SCHEDULED` |
| `golf-relative-field-pending-6d` | `scheduled` | Starts at 12:00 UTC about 6 days out; releases about 2 days from now; locks about 1 day before start | Included | Included | Blocked until `releaseAt`; after release it can become eligible if participants are loaded and not locked | No, because persisted status maps to `SCHEDULED` |
| `golf-relative-participant-boundary-7d` | `field_announced` | Starts at 12:00 UTC about 7 days out; released yesterday; locks about 1 day before start | Included | Included | Eligible after participants are loaded and until lock time | No, because persisted status maps to `SCHEDULED` |
| `golf-relative-schedule-boundary-30d` | `scheduled` | Starts at 11:00 UTC about 30 days out; releases about 22 days from now; locks about 1 day before start | Boundary case for the 30-day schedule window | Boundary case for the 30-day participant window | Blocked until release and participant load | No, because persisted status maps to `SCHEDULED` |

Boundary note: because the scheduler computes `to = now + N days` using the
current timestamp, not end-of-day, UTC-day generated boundary events can sit just
inside or just outside the window depending on the exact time of the run.

Timing note: provider `releaseAt` and `fieldLocksAt` values are honored when
present. Timing policies remain the fallback for providers that do not return
explicit event timing.

Manual-test lifecycle note: the manual-test event is anchored by the mock
provider clock. The event ID and display name include the computed event start
timestamp, so each cycle gives QA a uniquely identifiable event. The provider
recomputes the event status from its current clock on each request:

| Provider clock window | Provider status | PoolMaster effect after sync |
|---|---|---|
| Startup through +20 minutes | `field_announced`, field unlocked | Event is contest-eligible after schedule and participant sync hydrate it. |
| +20 through +40 minutes | `field_announced`, field locked | Contest creation is blocked after the next sync persists the locked field. |
| +40 through +60 minutes | `in_progress` | Live-score sync can poll the event and emit randomized score updates. |
| +60 through +80 minutes | `completed` | Result sync can poll the event and emit final finish-position results. |

After the completed window expires, the next provider request starts a fresh
manual-test cycle from that request time. This keeps a morning manual-test event
available even if the mock provider deployed overnight.

Manual syncs are useful for this flow: if the scheduled cadence has not reached
the next phase yet, run the relevant manual event or sport sync after the mock
provider phase changes.

## What To Expect During QA

For a healthy QA sync run with the mock provider:

1. Schedule sync should import events in the configured lookahead window.
2. Participant sync should hydrate event details for events in the schedule
   lookahead window, refresh persisted `IN_PROGRESS` events, and persist an
   80-player golf field for each generated golf event.
3. Ranking sync should return the mock golf rankings once participant mappings
   exist.
4. The scheduled live-score loop should poll only persisted `IN_PROGRESS` events
   for the active provider, including the manual-test event after a sync
   persists its live phase.
5. Live stats should affect contest scoring only for contests in `LOCKED` or
   `ACTIVE` status that contain roster picks for the scored participants.

If schedule and participant logs show records but the root-admin dashboard shows
all-zero scheduled job stats, that is a regression: scheduled job completions
should now persist into the dashboard's `ingestion_jobs` history source.
