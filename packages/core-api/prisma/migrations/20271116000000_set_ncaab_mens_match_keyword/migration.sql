-- #1496 part 4a: BALLDONTLIE's NCAA men's tournament events carry metadata.tour 'NCAAM'. Basketball's
-- NCAA Division I Men sport league takes that as its match keyword, so its year import and browse
-- find them. Only where nobody has set a keyword.
UPDATE sport_leagues
SET match_keyword = 'NCAAM', updated_at = now()
WHERE name = 'NCAA Division I Men'
  AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
