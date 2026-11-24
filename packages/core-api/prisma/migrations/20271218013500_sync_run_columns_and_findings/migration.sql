-- #1999: a sync run's outcome moves from payload_json into columns, and the sync's logged-only
-- warnings become sync findings. The request a run carried is not kept: its trigger and its
-- background job already say who and what started it, and its kind says which feed it synced.

-- New finding kinds. None is used in this migration.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'NO_PROVIDER_PARTICIPANTS';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'NO_PROVIDER_LIVE_SCORES';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAMES_NOT_SYNCED';

-- The run's outcome in columns.
ALTER TABLE "provider_sync_runs"
  ADD COLUMN "summary" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "stats" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "changed_count" INTEGER,
  ADD COLUMN "error_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the payload as every release wrote it: the outcome's summary, else the legacy
-- detail line; the stats object; the error count; and the rows a completed run changed (a feed
-- run's created, updated and deleted write counts, an events run's created and updated counts).
UPDATE "provider_sync_runs"
SET
  "summary" = COALESCE(NULLIF("payload_json" #>> '{outcome,summary}', ''), "payload_json" ->> 'detail', ''),
  "stats" = CASE WHEN jsonb_typeof("payload_json" -> 'stats') = 'object' THEN "payload_json" -> 'stats' ELSE '{}'::jsonb END,
  "error_count" = GREATEST(0, COALESCE(
    CASE WHEN jsonb_typeof("payload_json" #> '{outcome,errors}') = 'number' THEN ("payload_json" #>> '{outcome,errors}')::INTEGER END,
    CASE WHEN jsonb_typeof("payload_json" -> 'errors') = 'number' THEN ("payload_json" ->> 'errors')::INTEGER END,
    CASE WHEN "status" = 'FAILED' THEN 1 END,
    0)),
  "changed_count" = CASE WHEN "status" = 'COMPLETED' THEN COALESCE(
    CASE WHEN jsonb_typeof("payload_json" #> '{stats,writeCreated}') = 'number' AND jsonb_typeof("payload_json" #> '{stats,writeUpdated}') = 'number'
      THEN ("payload_json" #>> '{stats,writeCreated}')::INTEGER + ("payload_json" #>> '{stats,writeUpdated}')::INTEGER
        + CASE WHEN jsonb_typeof("payload_json" #> '{stats,writeDeleted}') = 'number' THEN ("payload_json" #>> '{stats,writeDeleted}')::INTEGER ELSE 0 END END,
    CASE WHEN jsonb_typeof("payload_json" #> '{stats,created}') = 'number' AND jsonb_typeof("payload_json" #> '{stats,updated}') = 'number'
      THEN ("payload_json" #>> '{stats,created}')::INTEGER + ("payload_json" #>> '{stats,updated}')::INTEGER END
  ) END;

ALTER TABLE "provider_sync_runs"
  ADD CONSTRAINT "provider_sync_runs_error_count_check" CHECK ("error_count" >= 0),
  ADD CONSTRAINT "provider_sync_runs_changed_count_check" CHECK ("changed_count" IS NULL OR "changed_count" >= 0);

ALTER TABLE "provider_sync_runs" DROP COLUMN "payload_json";
