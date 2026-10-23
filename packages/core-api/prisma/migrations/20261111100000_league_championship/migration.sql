-- #863 slice 1: the league championship. Each league gets its championship's name, and each
-- squad a row per settled contest it placed in, from its best entry, written at settlement.
-- Contests already final are backfilled here, scored exactly as packages/shared/domain/cup-points.ts
-- scores them.
ALTER TABLE "leagues" ADD COLUMN "cup_name" TEXT;
UPDATE "leagues" SET "cup_name" = "name" || ' Cup';
ALTER TABLE "leagues" ALTER COLUMN "cup_name" SET NOT NULL;

CREATE TABLE "league_year_finishes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "squad_id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "place" INTEGER NOT NULL,
    "tied_count" INTEGER NOT NULL,
    "ranked_entry_count" INTEGER NOT NULL,
    "event_series_id" UUID,
    "selection_type" "PrismaSelectionType" NOT NULL,
    "weight" "PrismaCupWeight" NOT NULL,
    "points" INTEGER NOT NULL,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_year_finishes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "league_year_finishes_league_id_year_idx" ON "league_year_finishes"("league_id", "year");
CREATE UNIQUE INDEX "league_year_finishes_contest_id_squad_id_key" ON "league_year_finishes"("contest_id", "squad_id");

-- The squad delete guard keeps a squad with results; the cascades let a league go whole.
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "league_year_finishes" ADD CONSTRAINT "league_year_finishes_event_series_id_fkey" FOREIGN KEY ("event_series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every final contest's ranked entries, each squad once at its best entry's place. The year is the
-- one the contest went final in, US Eastern; tied entries split the points of the places they cover.
WITH "ranked" AS (
  SELECT s."contest_id", e."squad_id", s."position",
    COUNT(*) OVER (PARTITION BY s."contest_id", s."position") AS "tied_count",
    COUNT(*) OVER (PARTITION BY s."contest_id") AS "ranked_entry_count"
  FROM "contest_entry_standings" s
  JOIN "contest_entries" e ON e."id" = s."contest_entry_id"
  JOIN "contests" c ON c."id" = s."contest_id"
  WHERE c."status" = 'COMPLETED' AND s."position" IS NOT NULL
), "best" AS (
  SELECT DISTINCT ON ("contest_id", "squad_id") *
  FROM "ranked"
  ORDER BY "contest_id", "squad_id", "position"
)
INSERT INTO "league_year_finishes" (
  "league_id", "year", "squad_id", "contest_id", "place", "tied_count", "ranked_entry_count",
  "event_series_id", "selection_type", "weight", "points", "settled_at"
)
SELECT
  c."league_id",
  EXTRACT(YEAR FROM (COALESCE(c."ends_at", c."updated_at") AT TIME ZONE 'America/New_York'))::INTEGER,
  b."squad_id",
  b."contest_id",
  b."position",
  b."tied_count",
  b."ranked_entry_count",
  (
    SELECT MIN(ev."event_series_id"::TEXT)::UUID
    FROM "contest_sport_events" cse
    JOIN "sport_events" ev ON ev."id" = cse."sport_event_id"
    WHERE cse."contest_id" = c."id"
    HAVING COUNT(*) = 1
  ),
  c."selection_type",
  c."cup_weight",
  ROUND(covered."points" * (CASE c."cup_weight" WHEN 'NORMAL' THEN 10 WHEN 'BONUS' THEN 15 WHEN 'DOUBLE' THEN 20 ELSE 0 END)::NUMERIC / b."tied_count")::INTEGER,
  COALESCE(c."ends_at", c."updated_at")
FROM "best" b
JOIN "contests" c ON c."id" = b."contest_id"
JOIN "leagues" l ON l."id" = c."league_id"
CROSS JOIN LATERAL (
  SELECT SUM(
    CASE l."cup_points_scale"
      WHEN 'STANDARD' THEN COALESCE((ARRAY[100, 80, 65, 55, 48, 42, 37, 33, 30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7])[p], 5)
      WHEN 'TOP_TEN' THEN COALESCE((ARRAY[25, 18, 15, 12, 10, 8, 6, 4, 2, 1])[p], 0)
      WHEN 'FIELD_BEATEN' THEN GREATEST(0, b."ranked_entry_count" - p + 1)
      ELSE COALESCE(l."cup_custom_points"[p], 0)
    END
  ) AS "points"
  FROM generate_series(b."position"::INTEGER, (b."position" + b."tied_count" - 1)::INTEGER) AS p
) covered;
