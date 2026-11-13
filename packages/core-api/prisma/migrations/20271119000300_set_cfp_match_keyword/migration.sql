-- #1496: BALLDONTLIE's College Football Playoff events and college football teams carry
-- metadata.tour 'CFP'. American football's College Football Playoff sport league takes that as
-- its match keyword, so its year import and browse find the playoff, and a provider team links
-- only to the site's team in the playoff. Only where nobody has set a keyword.
UPDATE sport_leagues
SET match_keyword = 'CFP', updated_at = now()
WHERE name = 'College Football Playoff'
  AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'AMERICAN_FOOTBALL');
