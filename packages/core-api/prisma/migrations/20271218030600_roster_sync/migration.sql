-- League model 21 part B (#2025): the roster sync, a sync kind of its own with a job per league.
ALTER TYPE "PrismaProviderSyncKind" ADD VALUE 'ROSTER';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SYNC_LEAGUE_ROSTER';

-- A saved schedule gains the roster sync's policy: no switch, daily in and off season. Its saved
-- changes in the per-state shape gain it too, so the schedule's history still reads them. With no
-- saved row, nothing changes: the code defaults apply.
UPDATE "platform_runtime_configs"
SET "config_json" = "config_json" || '{"ROSTER": {"intervals": {"IN_SEASON": {"intervalMinutes": 1440}, "OFFSEASON": {"intervalMinutes": 1440}}}}'::jsonb,
    "updated_at" = NOW()
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND COALESCE(("config_json" -> 'EVENTS') ? 'intervals', false)
  AND NOT "config_json" ? 'ROSTER';

UPDATE "platform_runtime_config_history"
SET "new_json" = "new_json" || '{"ROSTER": {"intervals": {"IN_SEASON": {"intervalMinutes": 1440}, "OFFSEASON": {"intervalMinutes": 1440}}}}'::jsonb
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND COALESCE(("new_json" -> 'EVENTS') ? 'intervals', false)
  AND NOT "new_json" ? 'ROSTER';

UPDATE "platform_runtime_config_history"
SET "previous_json" = "previous_json" || '{"ROSTER": {"intervals": {"IN_SEASON": {"intervalMinutes": 1440}, "OFFSEASON": {"intervalMinutes": 1440}}}}'::jsonb
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND "previous_json" IS NOT NULL
  AND COALESCE(("previous_json" -> 'EVENTS') ? 'intervals', false)
  AND NOT "previous_json" ? 'ROSTER';
