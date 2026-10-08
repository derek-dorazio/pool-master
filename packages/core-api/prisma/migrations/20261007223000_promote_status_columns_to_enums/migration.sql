-- #186: promote the remaining free-text lifecycle and discriminator columns to
-- Postgres enums, so the database rejects a value the code has no branch for.
--
-- Every column is checked before it is converted. A value outside the enum
-- (a typo, a retired name, an empty string, a different casing) aborts the
-- migration with the table, column and offending values named, rather than
-- failing inside the ALTER with a bare cast error. Nothing is remapped: an
-- unexpected value needs a person to decide what it should have been.

CREATE FUNCTION pg_temp.assert_values_fit_enum(tbl text, col text, enum_type text) RETURNS void AS $$
DECLARE
  bad text;
BEGIN
  EXECUTE format(
    'SELECT string_agg(DISTINCT quote_literal(%1$I), '', '') FROM %2$I '
    'WHERE %1$I IS NOT NULL AND %1$I NOT IN (SELECT unnest(enum_range(NULL::%3$I))::text)',
    col, tbl, enum_type
  ) INTO bad;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '#186: %.% holds values outside %: %', tbl, col, enum_type, bad;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE "PrismaContestStatus" AS ENUM ('DRAFT', 'OPEN', 'DRAFTING', 'LOCKED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PrismaSelectionType" AS ENUM ('SNAKE_DRAFT', 'TIERED', 'BUDGET_PICK', 'OPEN_SELECTION', 'PICK_EM', 'BRACKET_PICK_EM');
CREATE TYPE "PrismaScoringEngine" AS ENUM ('ADVANCEMENT', 'STAT_ACCUMULATION', 'STROKE_PLAY', 'POSITION', 'BRACKET', 'FIGHT_RESULT', 'CUMULATIVE');
CREATE TYPE "PrismaAutoPickPolicy" AS ENUM ('QUEUE_THEN_BEST', 'BEST_AVAILABLE', 'RANDOM');
CREATE TYPE "PrismaPrizePayoutType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');
CREATE TYPE "PrismaContestEntryStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PrismaDraftStatus" AS ENUM ('PENDING', 'LIVE', 'PAUSED', 'COMPLETE');
CREATE TYPE "PrismaParticipantRoundStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'DNF', 'DSQ', 'MISSED_CUT');
CREATE TYPE "PrismaProviderSyncRunStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

SELECT pg_temp.assert_values_fit_enum('contests', 'status', 'PrismaContestStatus');
SELECT pg_temp.assert_values_fit_enum('contests', 'selection_type', 'PrismaSelectionType');
SELECT pg_temp.assert_values_fit_enum('contests', 'scoring_engine', 'PrismaScoringEngine');
SELECT pg_temp.assert_values_fit_enum('contest_configurations', 'selection_type', 'PrismaSelectionType');
SELECT pg_temp.assert_values_fit_enum('contest_configurations', 'auto_pick_policy', 'PrismaAutoPickPolicy');
SELECT pg_temp.assert_values_fit_enum('contest_config_templates', 'contest_type', 'PrismaContestFormat');
SELECT pg_temp.assert_values_fit_enum('contest_config_templates', 'selection_type', 'PrismaSelectionType');
SELECT pg_temp.assert_values_fit_enum('contest_prize_definitions', 'payout_type', 'PrismaPrizePayoutType');
SELECT pg_temp.assert_values_fit_enum('contest_entries', 'status', 'PrismaContestEntryStatus');
SELECT pg_temp.assert_values_fit_enum('draft_sessions', 'status', 'PrismaDraftStatus');
SELECT pg_temp.assert_values_fit_enum('sport_event_participant_rounds', 'status', 'PrismaParticipantRoundStatus');
SELECT pg_temp.assert_values_fit_enum('provider_sync_runs', 'status', 'PrismaProviderSyncRunStatus');

ALTER TABLE "contests"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaContestStatus" USING "status"::"PrismaContestStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType" USING "selection_type"::"PrismaSelectionType",
  ALTER COLUMN "scoring_engine" TYPE "PrismaScoringEngine" USING "scoring_engine"::"PrismaScoringEngine";

ALTER TABLE "contest_configurations"
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType" USING "selection_type"::"PrismaSelectionType",
  ALTER COLUMN "auto_pick_policy" TYPE "PrismaAutoPickPolicy" USING "auto_pick_policy"::"PrismaAutoPickPolicy";

ALTER TABLE "contest_config_templates"
  ALTER COLUMN "contest_type" TYPE "PrismaContestFormat" USING "contest_type"::"PrismaContestFormat",
  ALTER COLUMN "selection_type" TYPE "PrismaSelectionType" USING "selection_type"::"PrismaSelectionType";

ALTER TABLE "contest_prize_definitions"
  ALTER COLUMN "payout_type" TYPE "PrismaPrizePayoutType" USING "payout_type"::"PrismaPrizePayoutType";

ALTER TABLE "contest_entries"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaContestEntryStatus" USING "status"::"PrismaContestEntryStatus",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "draft_sessions"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaDraftStatus" USING "status"::"PrismaDraftStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- The old 'PENDING' default was never a value the score paths write: every
-- round row is written with the status its scores came with. It is dropped, so
-- a write without a status fails instead of storing a status no reader handles.
ALTER TABLE "sport_event_participant_rounds"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaParticipantRoundStatus" USING "status"::"PrismaParticipantRoundStatus";

ALTER TABLE "provider_sync_runs"
  ALTER COLUMN "status" TYPE "PrismaProviderSyncRunStatus" USING "status"::"PrismaProviderSyncRunStatus";
