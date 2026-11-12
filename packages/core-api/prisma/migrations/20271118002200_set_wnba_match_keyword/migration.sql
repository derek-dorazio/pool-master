-- #1496: BALLDONTLIE's WNBA playoffs events and teams carry metadata.tour 'WNBA'. Basketball's year
-- import and the league-aware participant link find the WNBA sport league by its match keyword,
-- seeded NULL; only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = 'WNBA', updated_at = now()
WHERE name = 'WNBA' AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
