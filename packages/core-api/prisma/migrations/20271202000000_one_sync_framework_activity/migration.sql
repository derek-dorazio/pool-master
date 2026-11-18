-- One sync framework with one Activity log (#1819).
--
-- background_jobs: each job's scope (sport league, event) as indexed columns, so Activity filters
-- on them rather than on the JSON payload, and the result a succeeded job reports. A new job type
-- runs a sport league's events sync.
--
-- provider_sync_runs: each run says what it syncs (EVENTS, FIELD, SCORES), what started it
-- (SCHEDULE, WEBHOOK, ADMIN), its scope in PoolMaster's own ids, and the job that ran it.

CREATE TYPE "PrismaProviderSyncKind" AS ENUM ('EVENTS', 'FIELD', 'SCORES');
CREATE TYPE "PrismaProviderSyncTrigger" AS ENUM ('SCHEDULE', 'WEBHOOK', 'ADMIN');

ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SYNC_LEAGUE_EVENTS';

ALTER TABLE "background_jobs"
  ADD COLUMN "result" JSONB,
  ADD COLUMN "sport_event_id" UUID,
  ADD COLUMN "sport_league_id" UUID;

-- Every job type before #1819 that names an event names it as payload.sportEventId, except a
-- leaderboard rebuild of an event, which names it as payload.id.
UPDATE "background_jobs"
SET "sport_event_id" = ("payload"->>'sportEventId')::uuid
WHERE "payload"->>'sportEventId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE "background_jobs"
SET "sport_event_id" = ("payload"->>'id')::uuid
WHERE "type" = 'REBUILD_LEADERBOARDS'
  AND "payload"->>'subject' = 'EVENT'
  AND "payload"->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE INDEX "background_jobs_created_at_idx" ON "background_jobs"("created_at" DESC);
CREATE INDEX "background_jobs_sport_league_id_created_at_idx" ON "background_jobs"("sport_league_id", "created_at" DESC);
CREATE INDEX "background_jobs_sport_event_id_created_at_idx" ON "background_jobs"("sport_event_id", "created_at" DESC);

ALTER TABLE "provider_sync_runs"
  ADD COLUMN "background_job_id" UUID,
  ADD COLUMN "kind" "PrismaProviderSyncKind",
  ADD COLUMN "sport_event_id" UUID,
  ADD COLUMN "sport_league_id" UUID,
  ADD COLUMN "trigger" "PrismaProviderSyncTrigger";

-- Every run before #1819 synced one event's field or scores, named by payload.requestedFeed, and
-- was submitted by an admin, the schedule or a webhook, named by payload.runType.
UPDATE "provider_sync_runs"
SET
  "kind" = CASE WHEN "payload_json"->>'requestedFeed' = 'EVENTPARTICIPANTS' THEN 'FIELD' ELSE 'SCORES' END::"PrismaProviderSyncKind",
  "trigger" = CASE "payload_json"->>'runType'
    WHEN 'MANUAL_EVENT_SYNC' THEN 'ADMIN'
    WHEN 'WEBHOOK_EVENT_SYNC' THEN 'WEBHOOK'
    ELSE 'SCHEDULE'
  END::"PrismaProviderSyncTrigger";

-- The run's event, where PoolMaster has the provider event it synced linked.
UPDATE "provider_sync_runs" AS run
SET "sport_event_id" = event."id", "sport_league_id" = series."sport_league_id"
FROM "sport_events" AS event
JOIN "event_series" AS series ON series."id" = event."event_series_id"
WHERE run."event_id" IS NOT NULL
  AND event."provider_id" = run."provider_id"
  AND event."external_id" = run."event_id";

ALTER TABLE "provider_sync_runs"
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "trigger" SET NOT NULL;

CREATE INDEX "provider_sync_runs_background_job_id_idx" ON "provider_sync_runs"("background_job_id");
