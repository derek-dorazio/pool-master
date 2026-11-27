-- Where a game is played (#2047): each Game has its own venue and location, since a series moves
-- between both sides' homes. Empty until a feed sends one; a golf course stays on its event.
ALTER TABLE "sport_event_round_match_games" ADD COLUMN "venue" VARCHAR(500), ADD COLUMN "location" VARCHAR(500);
