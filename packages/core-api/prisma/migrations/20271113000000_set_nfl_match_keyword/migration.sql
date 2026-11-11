-- #1496: the NFL sport league finds BALLDONTLIE's NFL events (metadata.tour "NFL") for its year
-- import and keeps college football's events out of its browse. Only a keyword nobody has set.
UPDATE "sport_leagues"
SET "match_keyword" = 'NFL', "updated_at" = now()
WHERE "name" = 'NFL'
  AND "match_keyword" IS NULL
  AND "sport_id" = (SELECT "id" FROM "sports" WHERE "sport" = 'AMERICAN_FOOTBALL');
