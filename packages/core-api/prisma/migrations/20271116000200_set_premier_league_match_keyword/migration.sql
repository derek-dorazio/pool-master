-- #1496 part 4c: BALLDONTLIE's Premier League matchweek events and teams carry metadata.tour 'EPL'.
-- Soccer's Premier League sport league takes that as its match keyword, so its year import and
-- browse find the matchweeks, and a provider team links only to the site's Premier League team.
-- Only where nobody has set a keyword.
UPDATE sport_leagues
SET match_keyword = 'EPL', updated_at = now()
WHERE name = 'Premier League'
  AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'SOCCER');
