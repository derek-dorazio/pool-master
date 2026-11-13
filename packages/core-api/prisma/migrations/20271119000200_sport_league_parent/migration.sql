-- #1701: a playoff round's sport league names the season league it belongs to, so How to Play
-- and Contest types list each round under its league. Reference data: a migration that seeds a
-- new round league sets it with the league.
ALTER TABLE "sport_leagues" ADD COLUMN "parent_sport_league_id" UUID;

ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_parent_sport_league_id_fkey" FOREIGN KEY ("parent_sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each seeded round under its season league, both named within their sport.
UPDATE "sport_leagues" AS round
SET "parent_sport_league_id" = parent."id"
FROM (VALUES
  ('AMERICAN_FOOTBALL', 'Championship Weekend', 'NFL'),
  ('AMERICAN_FOOTBALL', 'Super Bowl', 'NFL'),
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', 'College Football Playoff'),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', 'College Football Playoff'),
  ('BASKETBALL', 'NBA Conference Finals', 'NBA'),
  ('BASKETBALL', 'NBA Finals', 'NBA'),
  ('BASKETBALL', 'WNBA Semifinals', 'WNBA'),
  ('BASKETBALL', 'WNBA Finals', 'WNBA'),
  ('BASKETBALL', 'Men''s Final Four', 'NCAA Division I Men'),
  ('BASKETBALL', 'Men''s Basketball National Championship', 'NCAA Division I Men'),
  ('BASEBALL', 'League Championship Series', 'MLB'),
  ('BASEBALL', 'World Series', 'MLB'),
  ('HOCKEY', 'NHL Conference Finals', 'NHL'),
  ('HOCKEY', 'Stanley Cup Final', 'NHL'),
  ('HOCKEY', 'Men''s Frozen Four', 'NCAA Division I Men'),
  ('HOCKEY', 'Men''s Hockey National Championship', 'NCAA Division I Men'),
  ('SOCCER', 'Champions League Semifinals', 'UEFA Champions League'),
  ('SOCCER', 'Champions League Final', 'UEFA Champions League'),
  ('SOCCER', 'Women''s World Cup Semifinals', 'FIFA Women''s World Cup'),
  ('SOCCER', 'Women''s World Cup Final', 'FIFA Women''s World Cup')
) AS rounds ("sport", "round_name", "parent_name")
JOIN "sports" ON "sports"."sport"::text = rounds."sport"
JOIN "sport_leagues" AS parent ON parent."sport_id" = "sports"."id" AND parent."name" = rounds."parent_name"
WHERE round."sport_id" = "sports"."id" AND round."name" = rounds."round_name";
