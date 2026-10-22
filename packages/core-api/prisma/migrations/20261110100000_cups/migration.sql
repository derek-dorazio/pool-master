-- #841 slice 1: sports league cups. Each contest gets its season (its first event's year) and a
-- cup weight; each league a points table; and every league gets a cup per season and sports league
-- it has a contest in.
CREATE TYPE "PrismaCupWeight" AS ENUM ('NORMAL', 'BONUS', 'DOUBLE', 'NOT_COUNTED');
CREATE TYPE "PrismaCupPointsScale" AS ENUM ('STANDARD', 'TOP_TEN', 'FIELD_BEATEN', 'CUSTOM');

ALTER TABLE "leagues"
  ADD COLUMN "cup_points_scale" "PrismaCupPointsScale" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "cup_custom_points" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  -- A custom table has points, and only a custom table does.
  ADD CONSTRAINT "leagues_cup_custom_points_check"
    CHECK (("cup_points_scale" = 'CUSTOM') = (cardinality("cup_custom_points") > 0));

ALTER TABLE "contests"
  ADD COLUMN "season_year" INTEGER,
  ADD COLUMN "cup_weight" "PrismaCupWeight" NOT NULL DEFAULT 'NORMAL';

-- Every contest has at least one event; its season is the year of the first.
UPDATE "contests" c
SET "season_year" = (
  SELECT e."event_year"
  FROM "contest_sport_events" cse
  JOIN "sport_events" e ON e."id" = cse."sport_event_id"
  WHERE cse."contest_id" = c."id"
  ORDER BY cse."sequence"
  LIMIT 1
);
-- A contest with no event, which no route can make, takes the year it was created.
UPDATE "contests" SET "season_year" = EXTRACT(YEAR FROM "created_at")::INTEGER WHERE "season_year" IS NULL;

ALTER TABLE "contests" ALTER COLUMN "season_year" SET NOT NULL;

CREATE INDEX "contests_league_id_season_year_idx" ON "contests"("league_id", "season_year");

CREATE TABLE "cups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "league_id" UUID NOT NULL,
  "season_year" INTEGER NOT NULL,
  "sport_league_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cups_league_id_season_year_sport_league_id_key" ON "cups"("league_id", "season_year", "sport_league_id");

-- A cup goes with its league; nothing else deletes one.
ALTER TABLE "cups" ADD CONSTRAINT "cups_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cups" ADD CONSTRAINT "cups_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A cup for every season and sports league a league already has a contest in.
INSERT INTO "cups" ("league_id", "season_year", "sport_league_id")
SELECT DISTINCT c."league_id", c."season_year", s."sport_league_id"
FROM "contests" c
JOIN "contest_sport_events" cse ON cse."contest_id" = c."id" AND cse."sequence" = 1
JOIN "sport_events" e ON e."id" = cse."sport_event_id"
JOIN "event_series" s ON s."id" = e."event_series_id"
ON CONFLICT DO NOTHING;
