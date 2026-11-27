-- #2154 (Derek 2026-11-27): the model knows a neutral-site game, and a neutral game shows "X vs Y"
-- while a home game shows "X at Y". Whether a slot's games are played at a neutral site is a fact
-- of the slot definition, the same for every league, and each Game of the slot takes it. Until now
-- each provider adapter decided it in code.
--
-- The leagues are found by URL segment and the slots by key or kind, never by name.

ALTER TABLE "sport_league_competition_slots" ADD COLUMN "is_neutral_site" BOOLEAN NOT NULL DEFAULT false;

-- Neutral sites, league by league:
-- * NFL: the Super Bowl.
-- * NCAA men's football: the bowl games, the conference title games, and the CFP from the
--   quarterfinals on (its first round is played at the higher seed's home).
-- * NCAA men's basketball: the whole tournament, the First Four included.
-- * NCAA women's basketball: from the round of 16 on (the regionals and the Final Four); its
--   First Four and first two rounds are played at the top 16 seeds' arenas.
-- * NCAA men's ice hockey: the whole tournament (regional sites, then the Frozen Four).
-- * NCAA women's ice hockey: the Frozen Four (its quarterfinals are played on campus).
-- * NCAA men's and women's soccer: the College Cup (semifinals and final).
-- * NCAA men's and women's tennis: from the round of 16 on, at the championship site.
-- * World Cup, Women's World Cup, Euro and Copa América: every slot, group matchdays included.
-- * Champions League and NWSL: the final.
-- * ATP and WTA: every tournament.
UPDATE "sport_league_competition_slots" s
SET "is_neutral_site" = true
FROM "sport_leagues" l, "sport_league_competitions" c
WHERE s."sport_league_id" = l."id"
  AND c."id" = s."sport_league_competition_id"
  AND (
    (l."url_segment" = 'nfl' AND s."key" = 'FINAL')
    OR (l."url_segment" = 'ncaamf' AND c."code" IN ('BOWLS', 'CONFERENCE_CHAMPIONSHIPS'))
    OR (l."url_segment" = 'ncaamf' AND c."code" = 'CFP' AND s."key" IN ('QUARTERFINAL', 'SEMIFINAL', 'FINAL'))
    OR (l."url_segment" IN ('ncaamb', 'ncaamh') AND c."code" = 'POSTSEASON')
    OR (l."url_segment" = 'ncaawb' AND s."key" IN ('ROUND_OF_16', 'QUARTERFINAL', 'SEMIFINAL', 'FINAL'))
    OR (l."url_segment" = 'ncaawh' AND s."key" IN ('SEMIFINAL', 'FINAL'))
    OR (l."url_segment" IN ('ncaams', 'ncaaws') AND s."key" IN ('SEMIFINAL', 'FINAL'))
    OR (l."url_segment" IN ('ncaamt', 'ncaawt') AND s."key" IN ('ROUND_OF_16', 'QUARTERFINAL', 'SEMIFINAL', 'FINAL'))
    OR (l."url_segment" IN ('world-cup', 'womens-world-cup', 'euro', 'copa-america') AND c."code" = 'POSTSEASON')
    OR (l."url_segment" IN ('ucl', 'nwsl') AND s."key" = 'FINAL')
    OR (l."url_segment" IN ('atp', 'wta') AND s."slot_kind" = 'TOURNAMENT')
  );

-- A new slot says whether it is neutral when it is seeded.
ALTER TABLE "sport_league_competition_slots" ALTER COLUMN "is_neutral_site" DROP DEFAULT;

-- Games already stored in a neutral slot take it, and their sides play neither home nor away.
-- The adapters marked only the Super Bowl, the NCAA basketball tournaments and the World Cup
-- neutral. One stored game is left as it was: a women's NCAA game of the First Four or the first
-- two rounds stays neutral, since which side was at home was never stored; its sync from now on
-- writes the home side.
UPDATE "sport_event_round_match_games" g
SET "is_neutral_site" = true
FROM "sport_event_slots" es, "sport_league_season_competition_slots" ss, "sport_league_competition_slots" d
WHERE es."id" = g."sport_event_slot_id"
  AND ss."id" = es."sport_league_season_competition_slot_id"
  AND d."id" = ss."sport_league_competition_slot_id"
  AND d."is_neutral_site"
  AND NOT g."is_neutral_site";

UPDATE "sport_event_round_match_game_side_results" r
SET "home_away" = 'NONE'
FROM "sport_event_round_match_games" g
WHERE g."id" = r."sport_event_round_match_game_id"
  AND g."is_neutral_site"
  AND r."home_away" <> 'NONE';
