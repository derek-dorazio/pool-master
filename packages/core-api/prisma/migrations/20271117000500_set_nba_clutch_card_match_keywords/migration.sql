-- #1497: BALLDONTLIE lists each NBA playoff round as an event of its own, it and its players
-- carrying the round's name as metadata.tour ("NBA Finals", "NBA Conference Finals"). The year
-- import and the league-aware participant link find a sport league by its match keyword, seeded
-- NULL on the two Clutch Card leagues; only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = name, updated_at = now()
WHERE name IN ('NBA Finals', 'NBA Conference Finals') AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
