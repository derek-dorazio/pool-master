-- #1102: basketball's and hockey's Clutch Card title-game leagues were both "Men's National
-- Championship", so the Clutch Card calendar showed two chips of one name. Each now names its
-- sport. Their setups keep their template keys. A match keyword equal to the old name follows it.
-- Idempotent: a league already renamed matches no row.
UPDATE "sport_leagues" l
SET "name" = rename."new_name",
    "match_keyword" = CASE WHEN l."match_keyword" = rename."old_name" THEN rename."new_name" ELSE l."match_keyword" END,
    "updated_at" = NOW()
FROM "sports" s
JOIN (VALUES
  ('BASKETBALL', 'Men''s National Championship', 'Men''s Basketball National Championship'),
  ('HOCKEY', 'Men''s National Championship', 'Men''s Hockey National Championship')
) AS rename("sport", "old_name", "new_name") ON s."sport"::text = rename."sport"
WHERE l."sport_id" = s."id" AND l."name" = rename."old_name";
