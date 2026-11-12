-- #1496: BALLDONTLIE's MLB postseason events and teams carry metadata.tour 'MLB'. Baseball's year
-- import and the league-aware participant link find the MLB sport league by its match keyword,
-- seeded NULL; only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = 'MLB', updated_at = now()
WHERE name = 'MLB' AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASEBALL');
