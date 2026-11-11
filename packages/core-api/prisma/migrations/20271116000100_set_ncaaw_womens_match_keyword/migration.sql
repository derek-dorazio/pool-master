-- #1496 part 4b: BALLDONTLIE's NCAA women's tournament events and teams carry metadata.tour 'NCAAW'.
-- Basketball's NCAA Division I Women sport league takes that as its match keyword, so its year
-- import and browse find the events, and a women's team links only to the site's women's team.
-- Only where nobody has set a keyword.
UPDATE sport_leagues
SET match_keyword = 'NCAAW', updated_at = now()
WHERE name = 'NCAA Division I Women'
  AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
