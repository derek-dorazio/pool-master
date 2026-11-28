-- #2021 (league model 20, part 1): a contest's championship year is its Season's, stored on the
-- contest and held to the Season by a composite key; a league's closed years are stored once.
--
-- 1. contests.championship_year, copied from each contest's Season, then held to it: the Season's
--    (id, championship_year) becomes a key the contest references in place of its id alone.
ALTER TABLE "contests" ADD COLUMN "championship_year" INTEGER;

UPDATE "contests" AS c
SET "championship_year" = s."championship_year"
FROM "sport_league_seasons" AS s
WHERE s."id" = c."sport_league_season_id";

ALTER TABLE "contests" ALTER COLUMN "championship_year" SET NOT NULL;

CREATE UNIQUE INDEX "sport_league_seasons_id_championship_year_key" ON "sport_league_seasons"("id", "championship_year");

ALTER TABLE "contests" DROP CONSTRAINT "contests_sport_league_season_id_fkey";
ALTER TABLE "contests" ADD CONSTRAINT "contests_season_year_fkey"
  FOREIGN KEY ("sport_league_season_id", "championship_year")
  REFERENCES "sport_league_seasons"("id", "championship_year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. A championship finish counts in its contest's championship year, not the year it settled:
--    an NFL 2025 playoffs contest final in February 2026 counts in 2025.
UPDATE "league_year_finishes" AS f
SET "year" = c."championship_year"
FROM "contests" AS c
WHERE c."id" = f."contest_id" AND f."year" <> c."championship_year";

-- 3. The year in review names its championship year. Renamed, so every sent review is kept.
DROP INDEX "league_year_reviews_league_id_year_key";
ALTER TABLE "league_year_reviews" RENAME COLUMN "year" TO "championship_year";
CREATE UNIQUE INDEX "league_year_reviews_league_id_championship_year_key" ON "league_year_reviews"("league_id", "championship_year");

-- 4. A league's closed championship years: a row per closed year, written once by the year
--    close and never deleted. Every year starts open; the year close writes the rows.
CREATE TABLE "league_championship_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "championship_year" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "league_championship_years_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "league_championship_years_league_id_championship_year_key" ON "league_championship_years"("league_id", "championship_year");

ALTER TABLE "league_championship_years" ADD CONSTRAINT "league_championship_years_league_id_fkey"
  FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. The jobs that close a year: after a contest goes final, and after a Season slot moves.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE IF NOT EXISTS 'CLOSE_LEAGUE_CHAMPIONSHIP_YEAR';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE IF NOT EXISTS 'CLOSE_SEASON_CHAMPIONSHIP_YEARS';
