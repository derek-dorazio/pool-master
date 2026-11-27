-- Slice 15b (#2050): a squares contest names its Game, not its match. A best-of series is one
-- match with several Games, so the match alone cannot say which game the boxes are played on.
-- Every match has its Game 1 from the moment it is loaded, and every squares contest so far was
-- built on a single game, so each one moves to its match's Game 1.
ALTER TABLE "contest_squares_games" ADD COLUMN "sport_event_round_match_game_id" UUID;

UPDATE "contest_squares_games" AS squares
SET "sport_event_round_match_game_id" = game."id"
FROM "sport_event_round_match_games" AS game
WHERE game."sport_event_round_match_id" = squares."sport_event_round_match_id"
  AND game."game_number" = 1;

-- A squares row whose match has no Game 1 cannot be played; none should exist, and one that
-- does is a broken draft with nothing to keep.
DELETE FROM "contest_squares_games" WHERE "sport_event_round_match_game_id" IS NULL;

ALTER TABLE "contest_squares_games" ALTER COLUMN "sport_event_round_match_game_id" SET NOT NULL;

ALTER TABLE "contest_squares_games"
  ADD CONSTRAINT "contest_squares_games_sport_event_round_match_game_id_fkey"
  FOREIGN KEY ("sport_event_round_match_game_id") REFERENCES "sport_event_round_match_games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "contest_squares_games_sport_event_round_match_game_id_idx" ON "contest_squares_games"("sport_event_round_match_game_id");

ALTER TABLE "contest_squares_games" DROP CONSTRAINT "contest_squares_games_sport_event_round_match_id_fkey";
DROP INDEX "contest_squares_games_sport_event_round_match_id_idx";
ALTER TABLE "contest_squares_games" DROP COLUMN "sport_event_round_match_id";

-- Which games a squares pool can be played on is the slot definition's `squares_eligible`
-- (a two-legged tie or a best-of-three series slot says no), so the league's first squares
-- round goes.
ALTER TABLE "sport_leagues" DROP CONSTRAINT "sport_leagues_squares_from_round_check";
ALTER TABLE "sport_leagues" DROP COLUMN "squares_from_round";
