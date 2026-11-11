-- #1496 part 4d: BALLDONTLIE's World Cup knockout events and teams carry metadata.tour 'FIFAWC'.
-- Soccer's FIFA World Cup sport league takes that as its match keyword, so its year import and
-- browse find the brackets, and a provider nation links only to the site's World Cup team.
-- Only where nobody has set a keyword.
UPDATE sport_leagues
SET match_keyword = 'FIFAWC', updated_at = now()
WHERE name = 'FIFA World Cup'
  AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'SOCCER');
