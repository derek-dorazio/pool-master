# Plan 103: Feed-Aware Ingestion Harness

## Purpose

Make the ingestion harness precise about both:

- `sport`
- `feed type`

so PoolMaster can request exactly the sync work it needs for a given lifecycle
window instead of relying on coarse, fixed sweeps.

Examples:

- 7 days before a golf event: sync event participants
- while a golf event is live: sync participant scores only
- after the event is complete: sync final results only

## Problem Statement

The current ingestion harness is split across broad methods with fixed intent:

- `syncSport(sport)` really means schedule sync
- participant sync is a separate periodic sweep
- ranking sync is a separate periodic sweep
- live score sync is a separate event-level call
- result sync is a separate event-level call

This makes the harness harder to control precisely:

- a caller cannot say "sync field but not schedule"
- a caller cannot say "sync live scores only"
- scheduled jobs are interval-based, not lifecycle-aware
- the runtime config supports per-sport cadence overrides, but not
  feed-specific orchestration intent

## Target Outcome

The ingestion harness should support explicit feed selection so both manual and
scheduled sync flows can ask for exactly the desired work.

Examples of supported intents:

- sport-level schedule sync
- sport-level participant/field sync
- sport-level rankings sync
- event-level live score sync
- event-level final results sync
- combined sync requests such as schedule + field for pre-event preparation

## Current Starting Point

Current harness entry points:

- [packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts](../packages/core-api/src/modules/ingestion/core/ingestion-scheduler.ts)
- [packages/core-api/src/modules/ingestion/routes.ts](../packages/core-api/src/modules/ingestion/routes.ts)
- [packages/core-api/src/modules/admin/ingestion-config-service.ts](../packages/core-api/src/modules/admin/ingestion-config-service.ts)

Current limitations:

- no feed-selector input model
- no single sync request object shared by manual and scheduled paths
- no lifecycle rule such as "field sync begins 7 days before event start"
- no ability to distinguish pre-event field hydration from live score polling in
  scheduler configuration

## Design Decisions

### 1. Introduce Explicit Feed Types

Add a first-class closed set for ingestion feed intent:

- `EVENTSCHEDULE`
- `EVENTPARTICIPANTS`
- `PARTICIPANTRANKINGS`
- `EVENTLIVESCORES`
- `EVENTRESULTS`

These replace the current implicit meaning of method names.

### 2. Introduce A Shared Sync Request Model

Define a request object that can be used by:

- scheduler-driven jobs
- manual admin/root-admin actions
- tests

Proposed shape:

```ts
type IngestionFeedType =
  | 'EVENTSCHEDULE'
  | 'EVENTPARTICIPANTS'
  | 'PARTICIPANTRANKINGS'
  | 'EVENTLIVESCORES'
  | 'EVENTRESULTS';

interface SportSyncRequest {
  sport: Sport;
  feeds: IngestionFeedType[];
  from?: Date;
  to?: Date;
}

interface EventSyncRequest {
  sport: Sport;
  eventId: string;
  feeds: Array<'EVENTPARTICIPANTS' | 'EVENTLIVESCORES' | 'EVENTRESULTS'>;
}
```

Key rule:

- sport-level sync is for discovery/catalog work
- event-level sync is for specific event hydration/polling work

### 3. Replace Coarse Methods With Feed-Aware Entry Points

Evolve the scheduler from:

- `syncSport(sport)`
- `pollLiveScores(sport, eventId)`
- `fetchEventResults(sport, eventId)`

to something like:

```ts
runSportSync(request: SportSyncRequest)
runEventSync(request: EventSyncRequest)
```

Wrapper methods can remain temporarily for compatibility, but they should
delegate to the new request-based API.

### 4. Add Lifecycle-Aware Scheduling Configuration

Extend ingestion scheduling config beyond interval-only fields.

Current config is cadence-based only:

- health checks
- schedule sync interval
- participant sync interval
- ranking sync interval
- live score polling interval

Add lifecycle-aware feed controls such as:

- `eventParticipantsLeadDays`
- `eventScheduleLookaheadDays`
- `eventLiveScoresIntervalSeconds`
- `eventResultsIntervalMinutes`
- per-sport feed enablement/disablement

Proposed direction:

```ts
interface FeedSchedulePolicy {
  enabled: boolean;
  intervalMinutes?: number;
  intervalHours?: number;
  leadDaysBeforeStart?: number;
}

interface IngestionFeedScheduleConfig {
  healthCheck: FeedSchedulePolicy;
  eventSchedule: FeedSchedulePolicy;
  eventParticipants: FeedSchedulePolicy;
  participantRankings: FeedSchedulePolicy;
  eventLiveScores: FeedSchedulePolicy;
  eventResults: FeedSchedulePolicy;
}
```

For golf:

- event schedule sync can run on a broader lookahead window
- event participants sync can begin 7 days before event start
- event live scores run only for in-progress events
- event results run only for completed/corrected events

### 5. Keep Feed Ownership Truthful

Feed meaning must stay explicit:

- `EVENTSCHEDULE` creates/updates the sporting event shell
- `EVENTPARTICIPANTS` hydrates event participants / participant-linked source data
- `PARTICIPANTRANKINGS` updates participant season rankings
- `EVENTLIVESCORES` updates active scoring stats only
- `EVENTRESULTS` updates final placements / official outcomes only

No single call should silently do unrelated feed work unless the caller asked
for multiple feed types.

### 6. Align Manual Admin Sync With The Same Model

The root-admin/manual sync paths should use the same feed-aware request model as
the scheduler.

That allows precise admin operations such as:

- "sync golf schedule only"
- "sync golf field only"
- "sync this event's live scores only"

This should replace the current broad "prepare contest-ready sport data"
behavior with an explicit multi-feed request under the hood, even if the UI
still offers opinionated presets.

## Proposed API Direction

### Manual Ingestion Routes

Keep sport and event routes, but add explicit feed parameters:

```http
POST /api/v1/ingestion/sync/GOLF
{
  "feeds": ["EVENTSCHEDULE", "EVENTPARTICIPANTS", "PARTICIPANTRANKINGS"],
  "from": "2026-04-01T00:00:00.000Z",
  "to": "2026-04-30T23:59:59.999Z"
}
```

```http
POST /api/v1/ingestion/events/GOLF/golf-masters-2026/sync
{
  "feeds": ["EVENTLIVESCORES"]
}
```

### Root-Admin Presets

The UI can still expose simple actions, but they should map to explicit feed
sets:

- `Prepare event data`
  - `["EVENTSCHEDULE", "EVENTPARTICIPANTS", "PARTICIPANTRANKINGS"]`
- `Refresh live scores`
  - `["EVENTLIVESCORES"]`
- `Refresh final results`
  - `["EVENTRESULTS"]`

## Canonical Naming Rule

The naming set above should be treated as canonical across:

- scheduler enums
- request/response DTOs
- ingestion config keys
- admin/root-admin UI labels
- plans, tests, and Beads

Do not mix legacy names like `FIELD` or `LIVE_SCORES` in some layers once the
rename implementation begins.

## Scope

- `packages/core-api/src/modules/ingestion/**/*`
- `packages/core-api/src/modules/admin/ingestion-config-service.ts`
- any admin/root-admin ingestion routes that trigger sync work
- shared DTO/OpenAPI/client surfaces for manual sync requests
- scheduler unit tests and integration coverage

## Out Of Scope

- provider-specific adapter redesign beyond what is needed to support feed-aware
  invocation
- commissioner-facing controls
- UI polish for advanced admin scheduling management

## Implementation Phases

### Phase 1: Define Feed-Aware Contracts

- add ingestion feed enums/types
- add sport-sync and event-sync request DTOs
- add route contracts for feed-aware manual sync

### Phase 2: Refactor Scheduler Entry Points

- add request-based `runSportSync()` and `runEventSync()`
- keep compatibility wrappers temporarily
- ensure jobs record the specific feed type(s) requested

### Phase 3: Make Scheduled Jobs Lifecycle-Aware

- replace coarse periodic sweeps with feed-specific scheduling rules
- support field sync lead windows such as 7 days before event start
- run live scores only for active events
- run results only for completed/corrected events

### Phase 4: Align Admin Config

- evolve ingestion config from interval-only fields to feed-aware policy
- keep per-sport overrides
- add validation for feed-specific policy combinations

### Phase 5: Align Root-Admin / Manual Controls

- update manual sync paths to send feed parameters
- keep simple presets where useful, but make them explicit under the hood

### Phase 6: Verify And Migrate

- update unit tests for scheduler behavior
- update integration/functional tests for manual sync contracts
- verify existing root-admin workflows still unblock testing with more precise
  feed selection

## Acceptance Criteria

- The ingestion harness accepts explicit feed parameters for both sport-level
  and event-level syncs.
- A caller can request field sync without implicitly running schedule, rankings,
  or live score sync.
- A caller can request live scores only for an event in progress.
- Scheduler configuration can express lifecycle-aware rules such as "sync field
  7 days before event start."
- Root-admin/manual sync controls map to explicit feed sets rather than hidden
  bundled work.

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 103-001 | 1 | Add feed-aware ingestion sync DTOs and route contracts | Completed | Added feed enums plus sport/event sync request schemas and multi-job ingestion responses |
| 103-002 | 2 | Refactor scheduler to accept sport/event sync requests with feed selection | Completed | Added `runSportSync()` and `runEventSync()` while keeping compatibility wrappers |
| 103-003 | 3 | Add lifecycle-aware field-sync scheduling such as 7-day lead windows | Completed | Scheduler now applies lookahead windows, field lead-day policies, and event-status-aware live/results sweeps through injected config and event readers |
| 103-004 | 4 | Evolve ingestion config service to feed-aware policy instead of cadence-only fields | Completed | Replaced flat cadence fields with nested feed policies plus deep-merged per-sport overrides |
| 103-005 | 5 | Update root-admin/manual sync flows to send explicit feed selections | Completed | Root-admin sport/event sync now sends explicit preset feed sets for prepare-data, field-only, live-scores-only, and results-only actions |
| 103-006 | 6 | Update scheduler/admin tests and ingestion functional coverage | Completed | Scheduler unit tests, root-admin functional/integration coverage, and the full local AGENTS gate suite passed against local Postgres |
