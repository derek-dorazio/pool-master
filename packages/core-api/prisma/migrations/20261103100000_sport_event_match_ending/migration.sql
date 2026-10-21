-- #704 slice 1: how a match with a result ended. PLAYED unless it stopped early: a retirement
-- (the loser stopped part way), a walkover (the loser never started) or a default
-- (disqualification). Every result so far was played to its end, so the column fills PLAYED.

-- CreateEnum
CREATE TYPE "PrismaMatchEnding" AS ENUM ('PLAYED', 'RETIREMENT', 'WALKOVER', 'DEFAULT');

-- AlterTable
ALTER TABLE "sport_event_matches"
  ADD COLUMN "ending" "PrismaMatchEnding" NOT NULL DEFAULT 'PLAYED';

-- A walkover was never played, so it has no score; a match without a result ended no way yet.
ALTER TABLE "sport_event_matches"
  ADD CONSTRAINT "sport_event_matches_ending_check"
  CHECK (
    "ending" = 'PLAYED'
    OR ("status" = 'COMPLETED' AND "winner_side" IS NOT NULL
      AND ("ending" <> 'WALKOVER' OR ("home_score" IS NULL AND "away_score" IS NULL)))
  );
