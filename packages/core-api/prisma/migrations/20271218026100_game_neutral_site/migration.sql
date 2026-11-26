-- #2047: the neutral-site flag moves onto the Game, and the Game's completedAt is the only one kept:
-- a match's completion time is read from its Games.
ALTER TABLE "sport_event_round_match_games" ADD COLUMN "is_neutral_site" BOOLEAN NOT NULL DEFAULT false;

UPDATE "sport_event_round_match_games" AS g
SET "is_neutral_site" = m."is_neutral_site"
FROM "sport_event_round_matches" AS m
WHERE m."id" = g."sport_event_round_match_id";

ALTER TABLE "sport_event_round_matches" DROP COLUMN "is_neutral_site", DROP COLUMN "completed_at";
