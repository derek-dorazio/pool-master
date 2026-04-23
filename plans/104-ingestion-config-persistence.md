# Plan 104: Persistent Ingestion Schedule Configuration

## Purpose

Persist the feed-aware ingestion schedule configuration so root-admin changes
survive service restarts and deployments in QA and production.

This closes the current gap where [packages/core-api/src/modules/admin/ingestion-config-service.ts](/Users/DDorazio/development/Github-Personal/pool-master/packages/core-api/src/modules/admin/ingestion-config-service.ts)
stores the active schedule only in memory.

## Problem Statement

The scheduler is now feed-aware and lifecycle-aware, but the configuration that
drives it is not durable:

- root-admin updates are lost on restart
- QA/prod scheduled behavior can drift back to defaults after deployment
- there is no persisted source of truth for sport/feed overrides
- audit logs show that a change happened, but not what configuration should be
  reloaded at boot

## Canonical Feed Naming

To reduce confusion, use one canonical naming set everywhere in code and docs:

- `EVENTSCHEDULE`
- `EVENTPARTICIPANTS`
- `PARTICIPANTRANKINGS`
- `EVENTLIVESCORES`
- `EVENTRESULTS`

Matching config object keys:

- `eventSchedule`
- `eventParticipants`
- `participantRankings`
- `eventLiveScores`
- `eventResults`

Why this set:

- event-scoped feeds are clearly event-scoped
- participant rankings stay correctly non-event-scoped
- `FIELD` is removed because it is golf-specific and does not match the domain
  model as well as `EVENTPARTICIPANTS`

## Recommendation

Persist the ingestion schedule as a database-backed configuration document using
interval-based scheduling only for v1.

We do not need cron right now.

The simpler v1 model is:

- `enabled`
- `intervalMinutes` or `intervalSeconds`
- `lookaheadDays`
- `leadDaysBeforeStart`
- per-sport overrides

Operationally:

- in-season sports stay enabled
- out-of-season sports are disabled
- the scheduler remains simple and predictable

## Proposed Persistence Model

Add a platform runtime config table dedicated to persisted operational config.

```prisma
model PlatformRuntimeConfig {
  id           String   @id @default(uuid()) @db.Uuid
  configKey    String   @unique @map("config_key")
  configJson   Json     @map("config_json")
  updatedById  String?  @map("updated_by_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("platform_runtime_configs")
}
```

Initial `configKey` values:

- `INGESTION_SCHEDULE_CONFIG`
- later: `POLL_INTERVAL_CONFIG`

Why a generic runtime config table:

- one persisted row per config domain
- JSON payload stays aligned with the admin DTO
- writes stay atomic
- easy reuse for poll config later

## Persisted Domain Object

```ts
type IngestionFeedSchedulePolicy = {
  enabled: boolean;
  intervalMinutes?: number;
  intervalSeconds?: number;
  lookaheadDays?: number;
  leadDaysBeforeStart?: number;
};

type IngestionScheduleConfigBody = {
  healthCheck: IngestionFeedSchedulePolicy;
  eventSchedule: IngestionFeedSchedulePolicy;
  eventParticipants: IngestionFeedSchedulePolicy;
  participantRankings: IngestionFeedSchedulePolicy;
  eventLiveScores: IngestionFeedSchedulePolicy;
  eventResults: IngestionFeedSchedulePolicy;
};

type IngestionScheduleConfig = IngestionScheduleConfigBody & {
  perSportOverrides: Record<string, Partial<IngestionScheduleConfigBody>>;
};
```

Rules:

- `intervalSeconds` is only valid for `eventLiveScores`
- `lookaheadDays` is only valid for `eventSchedule`
- `leadDaysBeforeStart` is only valid for `eventParticipants`
- `enabled: false` means the scheduler should not run that sport/feed

## Sample Persisted Row

```json
{
  "id": "8c7e6a22-98ae-4a37-b8f2-54dcd5d94e81",
  "configKey": "INGESTION_SCHEDULE_CONFIG",
  "updatedById": "2a7e0cc7-7f43-4fd4-8586-2ff2e6f77411",
  "createdAt": "2026-04-23T17:00:00.000Z",
  "updatedAt": "2026-04-23T17:20:00.000Z",
  "configJson": {
    "healthCheck": {
      "enabled": true,
      "intervalMinutes": 5
    },
    "eventSchedule": {
      "enabled": true,
      "intervalMinutes": 5,
      "lookaheadDays": 7
    },
    "eventParticipants": {
      "enabled": true,
      "intervalMinutes": 5,
      "leadDaysBeforeStart": 7
    },
    "participantRankings": {
      "enabled": true,
      "intervalMinutes": 1440
    },
    "eventLiveScores": {
      "enabled": true,
      "intervalSeconds": 30
    },
    "eventResults": {
      "enabled": true,
      "intervalMinutes": 5
    },
    "perSportOverrides": {
      "GOLF": {
        "eventSchedule": {
          "enabled": true,
          "intervalMinutes": 5,
          "lookaheadDays": 7
        },
        "eventParticipants": {
          "enabled": true,
          "intervalMinutes": 5,
          "leadDaysBeforeStart": 7
        }
      },
      "NFL": {
        "eventSchedule": {
          "enabled": false
        },
        "eventParticipants": {
          "enabled": false
        },
        "participantRankings": {
          "enabled": false
        },
        "eventLiveScores": {
          "enabled": false
        },
        "eventResults": {
          "enabled": false
        }
      }
    }
  }
}
```

## Scheduler Behavior

The scheduler should read persisted config at startup and before each loop
reschedule.

Resolution order:

1. load global persisted config
2. apply the per-sport override
3. if `enabled === false`, do not schedule that sport/feed loop
4. otherwise use `intervalSeconds` or `intervalMinutes`
5. apply lifecycle filtering when the loop runs

Lifecycle filtering remains separate from cadence:

- `eventSchedule.lookaheadDays` controls how far ahead discovery scans
- `eventParticipants.leadDaysBeforeStart` controls when participant hydration
  becomes eligible
- `eventLiveScores` only targets `IN_PROGRESS` events
- `eventResults` only targets `COMPLETED` / `OFFICIAL` events

## Why Not Cron In V1

We can get the needed behavior without cron:

- active sports stay enabled
- out-of-season sports are disabled
- interval scheduling stays easy to explain and test
- no cron parsing, timezone handling, or cadence-mode branching

We can revisit cron later if we truly need exact wall-clock control.

## Service Changes

Update [packages/core-api/src/modules/admin/ingestion-config-service.ts](/Users/DDorazio/development/Github-Personal/pool-master/packages/core-api/src/modules/admin/ingestion-config-service.ts)
to:

- load persisted config from Prisma on first access
- create the default row if none exists
- persist updates and resets
- merge per-sport overrides over global defaults
- return the same DTO contract to routes and the scheduler

Recommended module split:

- `IngestionConfigService`
  - validation
  - merge logic
  - default bootstrap
  - audit logging
- `PlatformRuntimeConfigRepository`
  - Prisma persistence for `configKey/configJson`
- scheduler
  - read-only consumer of effective policy

## API Contract Implications

The admin routes can stay stable:

- `GET /api/v1/admin/platform-config/ingestion`
- `PUT /api/v1/admin/platform-config/ingestion`
- `PUT /api/v1/admin/platform-config/ingestion/:sport`
- `POST /api/v1/admin/platform-config/ingestion/reset`

The DTO should evolve to the canonical naming set:

- `eventSchedule`
- `eventParticipants`
- `participantRankings`
- `eventLiveScores`
- `eventResults`

## Validation Rules

- require at least one override property on partial updates
- reject negative interval/window values
- reject `intervalSeconds` outside `eventLiveScores`
- reject `lookaheadDays` outside `eventSchedule`
- reject `leadDaysBeforeStart` outside `eventParticipants`
- require an interval value for enabled feeds
- reject malformed per-sport overrides that produce an invalid effective policy

## Naming Migration Plan

The naming change should be done consistently in one implementation lane:

1. DTOs and generated OpenAPI/client
2. scheduler feed enums and request types
3. admin/root-admin sync presets and labels
4. ingestion config service and persistence model
5. tests, plans, and Beads wording

Avoid mixed states like `FIELD` in one layer and `EVENTPARTICIPANTS` in another.

## Implementation Phases

### Phase 1

- add Prisma model + migration
- add repository/service persistence
- keep existing interval behavior

### Phase 2

- rename feed enums and config keys to the canonical naming set
- regenerate OpenAPI/client surfaces
- update admin/root-admin copy and presets

### Phase 3

- add restart-durability tests
- add per-sport enable/disable coverage
- persist poll config in the same table as a follow-on if desired

## Test Plan

### Unit

- merge global + per-sport override behavior
- default-row bootstrap behavior
- enabled/disabled resolution
- validation for event-specific window fields

### Integration

- admin update persists row to DB
- service restart reloads updated config
- reset restores persisted defaults

### Functional

- root-admin ingestion config endpoints round-trip persisted values
- disabled sport/feed policies stop scheduler work
- enabled golf policies continue to hydrate near-term events correctly

## Acceptance Criteria

- root-admin ingestion schedule changes survive restart
- scheduler boot loads persisted config rather than reset defaults
- per-sport feed overrides remain durable
- out-of-season sports can be disabled feed-by-feed
- canonical feed naming is used consistently across DTOs, scheduler, admin UI,
  tests, and docs
