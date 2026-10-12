-- #605 and #603: the model keeps only what is built, and the sport is a Postgres enum.
--
-- #605 removes catalog values nothing implements: every sport but GOLF, every tournament format
-- but STROKE_PLAY_TOURNAMENT, every contest format but ROSTER, and the SNAKE_DRAFT,
-- OPEN_SELECTION, PICK_EM and BRACKET_PICK_EM selection types. It drops two columns the scoring
-- family replaces: contests.scoring_engine (always STROKE_PLAY) and sports.category (unread).
-- Each value comes back with the migration of the code that builds it.
--
-- #603 stores the sport as the PrismaSport enum on sport_events, contest_config_templates and
-- provider_sync_runs, and renames sports.name to sports.sport with that type: the column always
-- held the Sport value, and the name a screen shows comes from code. It is `sport` rather than
-- `key` so the column reads like every other sport column and no unrelated `key` field becomes
-- enum-typed in the lint rules that read this schema.
--
-- The app cannot create a row holding a removed value (contest creation, event creation and
-- templates are golf, tiered or budget, roster only), so no real row holds one. A row a test or
-- a hand edit left behind is moved to the one built value, as #531 did, so the migration never
-- fails on it. A sport row other than GOLF has no built value to move to; one that nothing
-- references is deleted, and one that is referenced fails the cast below on purpose, because
-- its participants and events would need a decision.
--
-- Each enum type is rebuilt rather than altered: Postgres cannot drop a value from an enum.

-- Pick indexes for the removed contest formats. The ROSTER one is rebuilt around the type change
-- because its predicate names an enum value.
DROP INDEX "uq_pick_period_slot";
DROP INDEX "uq_pick_predicted_position";
DROP INDEX "uq_pick_survivor_week";
DROP INDEX "uq_pick_roster_participant";

-- Contest format.
ALTER TABLE "contests" ALTER COLUMN "contest_format" DROP DEFAULT;
ALTER TYPE "PrismaContestFormat" RENAME TO "PrismaContestFormat_old";
CREATE TYPE "PrismaContestFormat" AS ENUM ('ROSTER');
ALTER TABLE "contests"
  ALTER COLUMN "contest_format" TYPE "PrismaContestFormat" USING 'ROSTER'::"PrismaContestFormat";
ALTER TABLE "contest_entry_picks"
  ALTER COLUMN "contest_format" TYPE "PrismaContestFormat" USING 'ROSTER'::"PrismaContestFormat";
ALTER TABLE "contest_config_templates"
  ALTER COLUMN "contest_type" TYPE "PrismaContestFormat" USING 'ROSTER'::"PrismaContestFormat";
DROP TYPE "PrismaContestFormat_old";
ALTER TABLE "contests" ALTER COLUMN "contest_format" SET DEFAULT 'ROSTER';

CREATE UNIQUE INDEX "uq_pick_roster_participant"
  ON "contest_entry_picks" ("entry_id", "sport_event_participant_id")
  WHERE "contest_format" = 'ROSTER';

-- Selection type.
ALTER TYPE "PrismaSelectionType" RENAME TO "PrismaSelectionType_old";
CREATE TYPE "PrismaSelectionType" AS ENUM ('TIERED', 'BUDGET_PICK');
ALTER TABLE "contests"
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType"
  USING (CASE "selection_type"::text WHEN 'BUDGET_PICK' THEN 'BUDGET_PICK' ELSE 'TIERED' END)::"PrismaSelectionType";
ALTER TABLE "contest_configurations"
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType"
  USING (CASE "selection_type"::text WHEN 'BUDGET_PICK' THEN 'BUDGET_PICK' ELSE 'TIERED' END)::"PrismaSelectionType";
ALTER TABLE "contest_config_templates"
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType"
  USING (CASE "selection_type"::text WHEN 'BUDGET_PICK' THEN 'BUDGET_PICK' ELSE 'TIERED' END)::"PrismaSelectionType";
DROP TYPE "PrismaSelectionType_old";

-- Tournament format.
ALTER TYPE "PrismaTournamentFormat" RENAME TO "PrismaTournamentFormat_old";
CREATE TYPE "PrismaTournamentFormat" AS ENUM ('STROKE_PLAY_TOURNAMENT');
ALTER TABLE "sports"
  ALTER COLUMN "tournament_format" TYPE "PrismaTournamentFormat" USING 'STROKE_PLAY_TOURNAMENT'::"PrismaTournamentFormat";
DROP TYPE "PrismaTournamentFormat_old";

-- Scoring engine and sport category: the columns and their types go.
ALTER TABLE "contests" DROP COLUMN "scoring_engine";
DROP TYPE "PrismaScoringEngine";
ALTER TABLE "sports" DROP COLUMN "category";
DROP TYPE "PrismaSportCategory";

-- Sport.
CREATE TYPE "PrismaSport" AS ENUM ('GOLF');

-- Sync-run history is a log, not data anything reads back by sport: a run for another sport is
-- dropped rather than blocking the cast.
DELETE FROM "provider_sync_runs" WHERE "sport" <> 'GOLF';

-- The saved ingestion schedule may name a removed sport, which would make the whole stored
-- payload invalid and silently fall back to the defaults. Keep only its golf entries.
UPDATE "platform_runtime_configs"
SET "config_json" = jsonb_set(
  "config_json",
  '{scheduledSports}',
  COALESCE(
    (SELECT jsonb_agg(v) FROM jsonb_array_elements("config_json"->'scheduledSports') AS v WHERE v = '"GOLF"'::jsonb),
    '["GOLF"]'::jsonb
  )
)
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND jsonb_typeof("config_json"->'scheduledSports') = 'array';

UPDATE "platform_runtime_configs"
SET "config_json" = jsonb_set(
  "config_json",
  '{perSportOverrides}',
  COALESCE(
    (SELECT jsonb_object_agg(k, v) FROM jsonb_each("config_json"->'perSportOverrides') AS e(k, v) WHERE k = 'GOLF'),
    '{}'::jsonb
  )
)
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND jsonb_typeof("config_json"->'perSportOverrides') = 'object';

DELETE FROM "sports" s
WHERE s."name" <> 'GOLF'
  AND NOT EXISTS (SELECT 1 FROM "participants" p WHERE p."sport_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "sport_leagues" l WHERE l."sport_id" = s."id");

ALTER TABLE "sports" RENAME COLUMN "name" TO "sport";
ALTER TABLE "sports" ALTER COLUMN "sport" TYPE "PrismaSport" USING "sport"::"PrismaSport";
ALTER INDEX "sports_name_key" RENAME TO "sports_sport_key";

ALTER TABLE "sport_events" ALTER COLUMN "sport" TYPE "PrismaSport" USING "sport"::"PrismaSport";
ALTER TABLE "contest_config_templates" ALTER COLUMN "sport" TYPE "PrismaSport" USING "sport"::"PrismaSport";
ALTER TABLE "provider_sync_runs" ALTER COLUMN "sport" TYPE "PrismaSport" USING "sport"::"PrismaSport";
