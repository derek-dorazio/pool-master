-- #450 — settings registry: change history, and a stored ingestion config that reads cleanly.
--
-- 1. platform_runtime_config_history records every saved change to a settings group: the
--    previous and new payload, who saved it and when. Append-only. The DDL is generated with
--    `prisma migrate diff --from-url <migrated db> --to-schema-datamodel prisma/schema.prisma
--    --script`.
-- 2. Settings reads no longer write (#450), so the ingestion service's boot-time rewrite that
--    dropped the policies retired by #125 and #126 is gone. Any stored INGESTION_SCHEDULE_CONFIG
--    that still carries them is cleaned here instead: the retired keys are removed at the top
--    level and inside each per-sport override, and an override left with nothing in it is
--    dropped, since an empty override is not a valid one. Rows already clean are unchanged.

-- CreateTable
CREATE TABLE "platform_runtime_config_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_key" VARCHAR(100) NOT NULL,
    "previous_json" JSONB,
    "new_json" JSONB NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_runtime_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_runtime_config_history_config_key_changed_at_idx" ON "platform_runtime_config_history"("config_key", "changed_at" DESC);

-- Retired feed policies, top level
UPDATE "platform_runtime_configs"
SET "config_json" = "config_json" - 'participantRankings' - 'eventSchedule' - 'eventResults'
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND jsonb_typeof("config_json") = 'object'
  AND ("config_json" ?| ARRAY['participantRankings', 'eventSchedule', 'eventResults']);

-- Retired feed policies, inside per-sport overrides
UPDATE "platform_runtime_configs"
SET "config_json" = jsonb_set(
  "config_json",
  '{perSportOverrides}',
  COALESCE(
    (
      SELECT jsonb_object_agg(sport, cleaned)
      FROM (
        SELECT
          sport,
          CASE
            WHEN jsonb_typeof(override) = 'object'
              THEN override - 'participantRankings' - 'eventSchedule' - 'eventResults'
            ELSE override
          END AS cleaned
        FROM jsonb_each("config_json"->'perSportOverrides') AS overrides(sport, override)
      ) AS cleaned_overrides
      WHERE cleaned <> '{}'::jsonb
    ),
    '{}'::jsonb
  )
)
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND jsonb_typeof("config_json"->'perSportOverrides') = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each("config_json"->'perSportOverrides') AS overrides(sport, override)
    WHERE CASE
      WHEN jsonb_typeof(override) = 'object'
        THEN override ?| ARRAY['participantRankings', 'eventSchedule', 'eventResults']
      ELSE false
    END
  );
