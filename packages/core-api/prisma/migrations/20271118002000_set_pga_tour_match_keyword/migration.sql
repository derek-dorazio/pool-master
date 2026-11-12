-- #1666: BALLDONTLIE's PGA TOUR tournaments carry metadata.tour 'PGA TOUR'. Golf's year import
-- finds the PGA TOUR sport league by its match keyword, seeded NULL, and refuses a league with
-- none (422); only a league no admin has keyed is set.
UPDATE sport_leagues SET match_keyword = 'PGA TOUR', updated_at = now()
WHERE name = 'PGA TOUR' AND match_keyword IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'GOLF');
