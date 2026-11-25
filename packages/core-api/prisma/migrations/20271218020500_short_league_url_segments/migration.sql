-- League model 3d (#2143): names and short URL segments. The sport FOOTBALL is addressed as
-- `football`, and every sport league gets a short segment that names it on its own, in place of
-- the one 3c derived from its name. Each league is matched by its id. With no members on
-- production yet, an old address answers 404 like any unknown one: there is no redirect table.
-- A new league states its segment in the migration that seeds it.

UPDATE "sports" SET "url_segment" = 'football' WHERE "sport" = 'AMERICAN_FOOTBALL';

UPDATE "sport_leagues" AS "league" SET "url_segment" = "segment"."url_segment"
FROM (VALUES
  ('f91f2566-1978-4171-a706-ae417c4d601a'::uuid, 'nfl'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10'::uuid, 'ncaamf'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169'::uuid, 'nba'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61'::uuid, 'wnba'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc'::uuid, 'ncaamb'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46'::uuid, 'ncaawb'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296'::uuid, 'mlb'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d'::uuid, 'nhl'),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b'::uuid, 'pwhl'),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782'::uuid, 'ncaamh'),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317'::uuid, 'ncaawh'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2'::uuid, 'epl'),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5'::uuid, 'mls'),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18'::uuid, 'nwsl'),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546'::uuid, 'ucl'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8'::uuid, 'world-cup'),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001'::uuid, 'womens-world-cup'),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459'::uuid, 'euro'),
  ('acba33f8-d08b-40e9-9686-54263d3622ec'::uuid, 'copa-america'),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d'::uuid, 'ncaams'),
  ('28014434-2aa7-4950-af84-f952a7e81f42'::uuid, 'ncaaws'),
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5'::uuid, 'pga'),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d'::uuid, 'lpga'),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37'::uuid, 'f1'),
  ('b558b79e-be53-4741-a309-00be94c641ec'::uuid, 'nascar'),
  ('5eb10869-d5c2-4127-b549-037ab914d97e'::uuid, 'indycar'),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18'::uuid, 'atp'),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b'::uuid, 'wta'),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6'::uuid, 'ncaamt'),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3'::uuid, 'ncaawt'),
  ('52231de6-f739-43ff-b731-d5c86776beb8'::uuid, 'thoroughbred'),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164'::uuid, 'uci-men'),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2'::uuid, 'uci-women'),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5'::uuid, 'marathon-men'),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1'::uuid, 'marathon-women')
) AS "segment"("id", "url_segment")
WHERE "league"."id" = "segment"."id";

-- A segment names the league on its own (Derek 2026-11-25), so it is unique across every sport,
-- not only within one.
DROP INDEX "sport_leagues_sport_id_url_segment_key";
CREATE UNIQUE INDEX "sport_leagues_url_segment_key" ON "sport_leagues"("url_segment");

-- The NCAA leagues are named for what they are, the sport included, so the name says it beside
-- other sports' leagues too and no display name is needed. The football league was seeded under
-- the name of its postseason; the College Football Playoff is slots in its POSTSEASON phase.
UPDATE "sport_leagues" AS "league" SET "name" = "renamed"."name", "display_name" = NULL
FROM (VALUES
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10'::uuid, 'NCAA Men''s Football'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc'::uuid, 'NCAA Men''s Basketball'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46'::uuid, 'NCAA Women''s Basketball'),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782'::uuid, 'NCAA Men''s Hockey'),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317'::uuid, 'NCAA Women''s Hockey'),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d'::uuid, 'NCAA Men''s Soccer'),
  ('28014434-2aa7-4950-af84-f952a7e81f42'::uuid, 'NCAA Women''s Soccer'),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6'::uuid, 'NCAA Men''s Tennis'),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3'::uuid, 'NCAA Women''s Tennis')
) AS "renamed"("id", "name")
WHERE "league"."id" = "renamed"."id";

-- The sport's code is FOOTBALL (Derek 2026-11-25), as soccer's is SOCCER: what a screen calls
-- either is a display string. Renaming the value keeps every row that names it.
ALTER TYPE "PrismaSport" RENAME VALUE 'AMERICAN_FOOTBALL' TO 'FOOTBALL';
