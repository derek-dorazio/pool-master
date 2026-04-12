ALTER TABLE "leagues"
ADD COLUMN "league_code" VARCHAR(16);

UPDATE "leagues"
SET "league_code" = CONCAT(
  LEFT(
    COALESCE(NULLIF(UPPER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '', 'g')), ''), 'LEAGUE'),
    8
  ),
  RIGHT(REPLACE("id"::text, '-', ''), 8)
)
WHERE "league_code" IS NULL;

ALTER TABLE "leagues"
ALTER COLUMN "league_code" SET NOT NULL;

CREATE UNIQUE INDEX "leagues_league_code_key" ON "leagues"("league_code");
