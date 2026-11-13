-- #1716: horse racing's one sport league, US Thoroughbred (#623), joins the reference data, as
-- every other sport's leagues are, so Contest types lists it with horse racing's every-race
-- contest types. The Load of a horse racing data file already created it by name on a site
-- (QA): that row, its id and its events stay, and only an unset display order is filled.
INSERT INTO sport_leagues (id, sport_id, name, match_keyword, is_active, display_order, created_at, updated_at)
SELECT gen_random_uuid(), sports.id, 'US Thoroughbred', 'US Thoroughbred', true, 10, now(), now()
FROM sports
WHERE sports.sport = 'HORSE_RACING'
ON CONFLICT (sport_id, name) DO NOTHING;

UPDATE sport_leagues
SET display_order = 10, updated_at = now()
WHERE name = 'US Thoroughbred'
  AND display_order IS NULL
  AND sport_id = (SELECT id FROM sports WHERE sport = 'HORSE_RACING');
