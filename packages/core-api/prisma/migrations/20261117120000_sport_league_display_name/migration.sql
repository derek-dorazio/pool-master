-- What screens call a sport league away from its sport's own pages, when its name alone does
-- not say the sport: How to Play lists every sport's leagues side by side, and "NCAA Division I
-- Men" is a league of four sports. Null shows the name.
ALTER TABLE "sport_leagues" ADD COLUMN "display_name" VARCHAR(255);

-- The NCAA Division I leagues. Reference data, as their round names are.
UPDATE "sport_leagues" l SET "display_name" = names."display_name", "updated_at" = NOW()
FROM "sports" s, (VALUES
  ('BASKETBALL', 'NCAA Division I Men', 'NCAA Men''s Basketball'),
  ('BASKETBALL', 'NCAA Division I Women', 'NCAA Women''s Basketball'),
  ('HOCKEY', 'NCAA Division I Men', 'NCAA Men''s Hockey'),
  ('HOCKEY', 'NCAA Division I Women', 'NCAA Women''s Hockey'),
  ('SOCCER', 'NCAA Division I Men', 'NCAA Men''s Soccer'),
  ('SOCCER', 'NCAA Division I Women', 'NCAA Women''s Soccer'),
  ('TENNIS', 'NCAA Division I Men', 'NCAA Men''s Tennis'),
  ('TENNIS', 'NCAA Division I Women', 'NCAA Women''s Tennis')
) AS names("sport", "name", "display_name")
WHERE l."sport_id" = s."id" AND s."sport"::text = names."sport" AND l."name" = names."name";
