-- The college leagues' conferences (#2052), each with BALLDONTLIE's code for it on the league's
-- BALLDONTLIE mapping, from the vendor's /v1/conferences lists for ncaab, ncaaw and ncaaf. The
-- basketball feeds name a team's conference by its id, which differs between the men's and
-- women's lists (Great West, Pac-12), so each league's ids are its own; the football feed names it
-- by its name. College conferences have no divisions here. A league missing from this database is
-- skipped. Codes and names are ours; the feed's codes live only in the provider mappings.
CREATE TEMPORARY TABLE "seed_college_conferences" ("sport_league_id" UUID, "provider_league_code" TEXT, "code" TEXT, "name" TEXT, "description" TEXT, "display_order" INT, "provider_code" TEXT) ON COMMIT DROP;
INSERT INTO "seed_college_conferences" VALUES
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'AMERICA_EAST', 'America East Conference', 'An NCAA Division I conference in men''s basketball.', 1, '3'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'AMERICAN', 'American Conference', 'An NCAA Division I conference in men''s basketball.', 2, '4'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'ASUN', 'ASUN Conference', 'An NCAA Division I conference in men''s basketball.', 3, '2'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'ATLANTIC_10', 'Atlantic 10 Conference', 'An NCAA Division I conference in men''s basketball.', 4, '5'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'ACC', 'Atlantic Coast Conference', 'An NCAA Division I conference in men''s basketball.', 5, '1'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_12', 'Big 12 Conference', 'An NCAA Division I conference in men''s basketball.', 6, '6'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_EAST', 'Big East Conference', 'An NCAA Division I conference in men''s basketball.', 7, '7'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_SKY', 'Big Sky Conference', 'An NCAA Division I conference in men''s basketball.', 8, '8'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_SOUTH', 'Big South Conference', 'An NCAA Division I conference in men''s basketball.', 9, '9'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_TEN', 'Big Ten Conference', 'An NCAA Division I conference in men''s basketball.', 10, '10'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'BIG_WEST', 'Big West Conference', 'An NCAA Division I conference in men''s basketball.', 11, '11'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'COASTAL', 'Coastal Athletic Association', 'An NCAA Division I conference in men''s basketball.', 12, '12'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'CONFERENCE_USA', 'Conference USA', 'An NCAA Division I conference in men''s basketball.', 13, '13'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'INDEPENDENTS', 'Division I Independents', 'Independent NCAA Division I programs in men''s basketball, in no conference.', 14, '32'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'GREAT_WEST', 'Great West', 'An NCAA Division I conference in men''s basketball.', 15, '34'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'HORIZON', 'Horizon League', 'An NCAA Division I conference in men''s basketball.', 16, '14'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'IVY', 'Ivy League', 'An NCAA Division I conference in men''s basketball.', 17, '15'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MAAC', 'Metro Atlantic Athletic Conference', 'An NCAA Division I conference in men''s basketball.', 18, '16'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MID_AMERICAN', 'Mid-American Conference', 'An NCAA Division I conference in men''s basketball.', 19, '18'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MID_CON', 'Mid Continent Conference', 'An NCAA Division I conference in men''s basketball.', 20, '35'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MEAC', 'Mid-Eastern Athletic Conference', 'An NCAA Division I conference in men''s basketball.', 21, '17'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MISSOURI_VALLEY', 'Missouri Valley Conference', 'An NCAA Division I conference in men''s basketball.', 22, '19'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'MOUNTAIN_WEST', 'Mountain West Conference', 'An NCAA Division I conference in men''s basketball.', 23, '20'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'NORTHEAST', 'Northeast Conference', 'An NCAA Division I conference in men''s basketball.', 24, '21'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'OHIO_VALLEY', 'Ohio Valley Conference', 'An NCAA Division I conference in men''s basketball.', 25, '22'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'PAC_12', 'Pac-12 Conference', 'An NCAA Division I conference in men''s basketball.', 26, '33'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'PATRIOT', 'Patriot League', 'An NCAA Division I conference in men''s basketball.', 27, '23'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SEC', 'Southeastern Conference', 'An NCAA Division I conference in men''s basketball.', 28, '24'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SOUTHERN', 'Southern Conference', 'An NCAA Division I conference in men''s basketball.', 29, '26'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SOUTHLAND', 'Southland Conference', 'An NCAA Division I conference in men''s basketball.', 30, '27'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SWAC', 'Southwestern Athletic Conference', 'An NCAA Division I conference in men''s basketball.', 31, '25'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SUMMIT', 'Summit League', 'An NCAA Division I conference in men''s basketball.', 32, '28'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'SUN_BELT', 'Sun Belt Conference', 'An NCAA Division I conference in men''s basketball.', 33, '29'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'WEST_COAST', 'West Coast Conference', 'An NCAA Division I conference in men''s basketball.', 34, '31'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'ncaab', 'WAC', 'Western Athletic Conference', 'An NCAA Division I conference in men''s basketball.', 35, '30'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'AMERICA_EAST', 'America East Conference', 'An NCAA Division I conference in women''s basketball.', 1, '3'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'AMERICAN', 'American Conference', 'An NCAA Division I conference in women''s basketball.', 2, '4'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'ASUN', 'ASUN Conference', 'An NCAA Division I conference in women''s basketball.', 3, '2'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'ATLANTIC_10', 'Atlantic 10 Conference', 'An NCAA Division I conference in women''s basketball.', 4, '5'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'ACC', 'Atlantic Coast Conference', 'An NCAA Division I conference in women''s basketball.', 5, '1'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_12', 'Big 12 Conference', 'An NCAA Division I conference in women''s basketball.', 6, '6'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_EAST', 'Big East Conference', 'An NCAA Division I conference in women''s basketball.', 7, '7'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_SKY', 'Big Sky Conference', 'An NCAA Division I conference in women''s basketball.', 8, '8'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_SOUTH', 'Big South Conference', 'An NCAA Division I conference in women''s basketball.', 9, '9'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_TEN', 'Big Ten Conference', 'An NCAA Division I conference in women''s basketball.', 10, '10'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'BIG_WEST', 'Big West Conference', 'An NCAA Division I conference in women''s basketball.', 11, '11'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'COASTAL', 'Coastal Athletic Association', 'An NCAA Division I conference in women''s basketball.', 12, '12'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'CONFERENCE_USA', 'Conference USA', 'An NCAA Division I conference in women''s basketball.', 13, '13'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'INDEPENDENTS', 'Division I Independents', 'Independent NCAA Division I programs in women''s basketball, in no conference.', 14, '32'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'GREAT_WEST', 'Great West', 'An NCAA Division I conference in women''s basketball.', 15, '33'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'HORIZON', 'Horizon League', 'An NCAA Division I conference in women''s basketball.', 16, '14'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'IVY', 'Ivy League', 'An NCAA Division I conference in women''s basketball.', 17, '15'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'MAAC', 'Metro Atlantic Athletic Conference', 'An NCAA Division I conference in women''s basketball.', 18, '16'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'MID_AMERICAN', 'Mid-American Conference', 'An NCAA Division I conference in women''s basketball.', 19, '18'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'MEAC', 'Mid-Eastern Athletic Conference', 'An NCAA Division I conference in women''s basketball.', 20, '17'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'MISSOURI_VALLEY', 'Missouri Valley Conference', 'An NCAA Division I conference in women''s basketball.', 21, '19'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'MOUNTAIN_WEST', 'Mountain West Conference', 'An NCAA Division I conference in women''s basketball.', 22, '20'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'NORTHEAST', 'Northeast Conference', 'An NCAA Division I conference in women''s basketball.', 23, '21'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'OHIO_VALLEY', 'Ohio Valley Conference', 'An NCAA Division I conference in women''s basketball.', 24, '22'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'PAC_12', 'Pac-12 Conference', 'An NCAA Division I conference in women''s basketball.', 25, '34'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'PATRIOT', 'Patriot League', 'An NCAA Division I conference in women''s basketball.', 26, '23'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SEC', 'Southeastern Conference', 'An NCAA Division I conference in women''s basketball.', 27, '24'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SOUTHERN', 'Southern Conference', 'An NCAA Division I conference in women''s basketball.', 28, '26'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SOUTHLAND', 'Southland Conference', 'An NCAA Division I conference in women''s basketball.', 29, '27'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SWAC', 'Southwestern Athletic Conference', 'An NCAA Division I conference in women''s basketball.', 30, '25'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SUMMIT', 'Summit League', 'An NCAA Division I conference in women''s basketball.', 31, '28'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'SUN_BELT', 'Sun Belt Conference', 'An NCAA Division I conference in women''s basketball.', 32, '29'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'WEST_COAST', 'West Coast Conference', 'An NCAA Division I conference in women''s basketball.', 33, '31'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'ncaaw', 'WAC', 'Western Athletic Conference', 'An NCAA Division I conference in women''s basketball.', 34, '30'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'ACC', 'Atlantic Coast Conference', 'An NCAA Division I football conference.', 1, 'ACC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'AMERICAN', 'American Conference', 'An NCAA Division I football conference.', 2, 'American'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'BIG_12', 'Big 12 Conference', 'An NCAA Division I football conference.', 3, 'Big 12'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'BIG_SKY', 'Big Sky Conference', 'An NCAA Division I football conference.', 4, 'Big Sky'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'BIG_TEN', 'Big Ten Conference', 'An NCAA Division I football conference.', 5, 'Big Ten'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'CAA', 'Coastal Athletic Association Football Conference', 'An NCAA Division I football conference.', 6, 'CAA'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'CONFERENCE_USA', 'Conference USA', 'An NCAA Division I football conference.', 7, 'CUSA'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'FBS_INDEPENDENTS', 'FBS Independents', 'Independent NCAA Division I football programs, in no conference.', 8, 'FBS Indep.'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'FCS_INDEPENDENTS', 'FCS Independents', 'Independent NCAA Division I football programs, in no conference.', 9, 'FCS Indep.'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'IVY', 'Ivy League', 'An NCAA Division I football conference.', 10, 'Ivy'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'MID_AMERICAN', 'Mid-American Conference', 'An NCAA Division I football conference.', 11, 'MAC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'MEAC', 'Mid-Eastern Athletic Conference', 'An NCAA Division I football conference.', 12, 'MEAC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'MOUNTAIN_WEST', 'Mountain West Conference', 'An NCAA Division I football conference.', 13, 'Mountain West'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'MISSOURI_VALLEY', 'Missouri Valley Football Conference', 'An NCAA Division I football conference.', 14, 'MVFC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'NORTHEAST', 'Northeast Conference', 'An NCAA Division I football conference.', 15, 'NEC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'OVC_BIG_SOUTH', 'Big South-OVC Football Association', 'An NCAA Division I football conference.', 16, 'OVC-Big South'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'PAC_12', 'Pac-12 Conference', 'An NCAA Division I football conference.', 17, 'Pac-12'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'PATRIOT', 'Patriot League', 'An NCAA Division I football conference.', 18, 'Patriot'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'PIONEER', 'Pioneer Football League', 'An NCAA Division I football conference.', 19, 'Pioneer'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'SEC', 'Southeastern Conference', 'An NCAA Division I football conference.', 20, 'SEC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'SOUTHERN', 'Southern Conference', 'An NCAA Division I football conference.', 21, 'Southern'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'SOUTHLAND', 'Southland Conference', 'An NCAA Division I football conference.', 22, 'Southland'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'SUN_BELT', 'Sun Belt Conference', 'An NCAA Division I football conference.', 23, 'Sun Belt'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'SWAC', 'Southwestern Athletic Conference', 'An NCAA Division I football conference.', 24, 'SWAC'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'ncaaf', 'UAC', 'United Athletic Conference', 'An NCAA Division I football conference.', 25, 'UAC');

INSERT INTO "sport_league_conferences" ("sport_league_id", "code", "name", "description", "display_order", "updated_at")
SELECT s."sport_league_id", s."code", s."name", s."description", s."display_order", now()
FROM "seed_college_conferences" s
WHERE EXISTS (SELECT 1 FROM "sport_leagues" l WHERE l."id" = s."sport_league_id");

INSERT INTO "sport_league_conference_provider_mappings" ("sport_league_id", "conference_id", "sport_league_provider_mapping_id", "provider_code", "updated_at")
SELECT c."sport_league_id", c."id", m."id", s."provider_code", now()
FROM "seed_college_conferences" s
JOIN "sport_league_conferences" c ON c."sport_league_id" = s."sport_league_id" AND c."code" = s."code"
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = c."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id"
  AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
  AND pl."code" = s."provider_league_code";
