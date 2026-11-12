-- #1496: BALLDONTLIE's NHL playoffs events and teams carry metadata.tour 'NHL'. Hockey's year
-- import and the league-aware participant link find the NHL sport league by its match keyword,
-- seeded NULL; only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = 'NHL', updated_at = now()
WHERE name = 'NHL' AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'HOCKEY');
