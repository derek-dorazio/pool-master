-- #1496: BALLDONTLIE's NBA playoffs events and teams carry metadata.tour 'NBA'. Basketball's year
-- import and the league-aware participant link find the NBA sport league by its match keyword,
-- seeded NULL; only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = 'NBA', updated_at = now()
WHERE name = 'NBA' AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
