-- #2069: a mapping, however it is made, resolves its feed id's unmapped participant finding by a job.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS';

-- #2086: the FIELD sync has no switch; it always runs, for synced sport leagues. A saved schedule
-- drops its FIELD "enabled" and keeps the rest. With no saved row, nothing changes.
UPDATE "platform_runtime_configs"
SET "config_json" = jsonb_set("config_json", '{FIELD}', ("config_json" -> 'FIELD') - 'enabled'),
    "updated_at" = NOW()
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND "config_json" ? 'FIELD';
