-- League model 5b (#2043, plans/league-model-redesign.md §1 and §9b): each slot definition says
-- how its games are contested, whether one can finish level, and what a game is played in.
--
-- The backfill carries today's facts over once, and nothing in code reads a sport for them again:
-- * matchFormat: the league's scoring family. Head-to-head leagues meet two sides; stroke play and
--   finish position rank a whole field.
-- * canEndTied: a soccer game that may end in a draw: the regular season, and each leg of a
--   two-legged tie, which is settled on aggregate. A one-game soccer knockout is settled by a
--   shoot-out, and every other sport's games play on until someone wins. That is the sport
--   registry's `pickEm.tiePicks` and `shootout`, which later slices stop reading.
-- * periods: each league's own layout (men's college basketball plays halves), else its sport's:
--   four quarters, two halves, three periods, nine innings or eighteen holes. A race and a tennis
--   match keep no score by period, so they get none.

-- CreateEnum
CREATE TYPE "PrismaMatchFormat" AS ENUM ('HEAD_TO_HEAD', 'FIELD');

-- CreateEnum
CREATE TYPE "PrismaPeriodUnit" AS ENUM ('QUARTER', 'HALF', 'PERIOD', 'INNING', 'HOLE');

-- AlterTable
ALTER TABLE "sport_league_phase_slots" ADD COLUMN "match_format" "PrismaMatchFormat",
ADD COLUMN "can_end_tied" BOOLEAN,
ADD COLUMN "period_unit" "PrismaPeriodUnit",
ADD COLUMN "period_count" INTEGER;

UPDATE "sport_league_phase_slots" slot
SET "match_format" = (CASE sl."scoring_family" WHEN 'HEAD_TO_HEAD' THEN 'HEAD_TO_HEAD' ELSE 'FIELD' END)::"PrismaMatchFormat",
    "can_end_tied" = (s."sport" = 'SOCCER' AND (ph."phase" = 'REGULAR' OR slot."series_format" = 'AGGREGATE')),
    "period_unit" = (CASE
        WHEN sl."match_period_layout" = 'HALVES' THEN 'HALF'
        WHEN sl."match_period_layout" = 'QUARTERS' THEN 'QUARTER'
        WHEN sl."match_period_layout" = 'THREE_PERIODS' THEN 'PERIOD'
        WHEN s."sport" IN ('AMERICAN_FOOTBALL', 'BASKETBALL') THEN 'QUARTER'
        WHEN s."sport" = 'SOCCER' THEN 'HALF'
        WHEN s."sport" = 'HOCKEY' THEN 'PERIOD'
        WHEN s."sport" = 'BASEBALL' THEN 'INNING'
        WHEN s."sport" = 'GOLF' THEN 'HOLE'
      END)::"PrismaPeriodUnit"
FROM "sport_league_phases" ph, "sport_leagues" sl, "sports" s
WHERE ph."id" = slot."sport_league_phase_id" AND sl."id" = slot."sport_league_id" AND s."id" = sl."sport_id";

UPDATE "sport_league_phase_slots"
SET "period_count" = CASE "period_unit"
    WHEN 'QUARTER' THEN 4
    WHEN 'HALF' THEN 2
    WHEN 'PERIOD' THEN 3
    WHEN 'INNING' THEN 9
    WHEN 'HOLE' THEN 18
  END
WHERE "period_unit" IS NOT NULL;

ALTER TABLE "sport_league_phase_slots" ALTER COLUMN "match_format" SET NOT NULL,
ALTER COLUMN "can_end_tied" SET NOT NULL;

-- What the schema cannot say: a period count goes with its unit, and a game has at least one.
ALTER TABLE "sport_league_phase_slots"
  ADD CONSTRAINT "sport_league_phase_slots_periods" CHECK (("period_unit" IS NULL) = ("period_count" IS NULL) AND ("period_count" IS NULL OR "period_count" >= 1));
