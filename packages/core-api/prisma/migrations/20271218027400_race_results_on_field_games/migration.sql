-- #2008 (10b part 3a): a race is one FIELD Match in the event's first round, with every runner
-- as a side and one Game. Each runner's result moves from sport_event_participant_race_results
-- onto that Game's side results, its jockey with it. The race's official flag
-- becomes the Game's status: COMPLETED once official, IN_PROGRESS while provisional.

-- How a side's part in a FIELD Game ended: the race result status, renamed.
ALTER TYPE "RaceResultStatus" RENAME TO "GameSideStatus";

-- A FIELD match numbers its sides 1 to n.
ALTER TABLE "sport_event_round_match_sides" DROP CONSTRAINT "sport_event_round_match_sides_side_number_check";
ALTER TABLE "sport_event_round_match_sides" ADD CONSTRAINT "sport_event_round_match_sides_side_number_check" CHECK ("side_number" >= 1);

ALTER TABLE "sport_event_round_match_game_side_results"
  ADD COLUMN "position" INTEGER,
  ADD COLUMN "start_position" INTEGER,
  ADD COLUMN "status" "GameSideStatus",
  ADD COLUMN "rider_name" VARCHAR(255),
  ADD CONSTRAINT "sport_event_round_match_game_side_results_position_check" CHECK ("position" IS NULL OR "position" >= 1),
  ADD CONSTRAINT "sport_event_round_match_game_side_results_start_position_check" CHECK ("start_position" IS NULL OR "start_position" >= 1),
  ADD CONSTRAINT "sport_event_round_match_game_side_results_place_only_when_finished_check" CHECK ("position" IS NULL OR "status" = 'FINISHED');

-- Each event with a result: its first round, and whether the race is official.
CREATE TEMP TABLE "race_moves" AS
SELECT
  p."sport_event_id",
  first_round."id" AS "sport_event_round_id",
  first_round."sport_event_slot_id",
  bool_or(r."is_official") AS "is_official",
  max(r."updated_at") AS "last_result_at",
  gen_random_uuid() AS "match_id",
  gen_random_uuid() AS "game_id"
FROM "sport_event_participant_race_results" AS r
JOIN "sport_event_participants" AS p ON p."id" = r."sport_event_participant_id"
JOIN LATERAL (
  SELECT sr."id", sr."sport_event_slot_id"
  FROM "sport_event_rounds" AS sr
  WHERE sr."sport_event_id" = p."sport_event_id"
  ORDER BY sr."round_number"
  LIMIT 1
) AS first_round ON TRUE
GROUP BY p."sport_event_id", first_round."id", first_round."sport_event_slot_id";

-- A result whose event has no round cannot move; refuse rather than drop it.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "sport_event_participant_race_results" AS r JOIN "sport_event_participants" AS p ON p."id" = r."sport_event_participant_id" WHERE p."sport_event_id" NOT IN (SELECT "sport_event_id" FROM "race_moves")) THEN RAISE EXCEPTION 'A race result belongs to an event with no round, so it has no Game to move to.'; END IF; END $$;

INSERT INTO "sport_event_round_matches" ("id", "sport_event_id", "sport_event_round_id", "match_number", "status", "updated_at")
SELECT
  m."match_id",
  m."sport_event_id",
  m."sport_event_round_id",
  COALESCE((SELECT max(x."match_number") FROM "sport_event_round_matches" AS x WHERE x."sport_event_round_id" = m."sport_event_round_id"), 0) + 1,
  CASE WHEN m."is_official" THEN 'COMPLETED' ELSE 'IN_PROGRESS' END::"PrismaMatchStatus",
  now()
FROM "race_moves" AS m;

INSERT INTO "sport_event_round_match_games" ("id", "sport_event_id", "sport_event_round_match_id", "sport_event_slot_id", "game_number", "status", "completed_at", "updated_at")
SELECT
  m."game_id",
  m."sport_event_id",
  m."match_id",
  m."sport_event_slot_id",
  1,
  CASE WHEN m."is_official" THEN 'COMPLETED' ELSE 'IN_PROGRESS' END::"PrismaMatchStatus",
  CASE WHEN m."is_official" THEN m."last_result_at" ELSE NULL END,
  now()
FROM "race_moves" AS m;

-- Sides numbered by finishing place, then field row, so the number is stable.
CREATE TEMP TABLE "race_side_moves" AS
SELECT
  gen_random_uuid() AS "side_id",
  m."sport_event_id",
  m."match_id",
  m."game_id",
  r.*,
  row_number() OVER (PARTITION BY m."match_id" ORDER BY r."finish_position" NULLS LAST, r."sport_event_participant_id") AS "side_number"
FROM "sport_event_participant_race_results" AS r
JOIN "sport_event_participants" AS p ON p."id" = r."sport_event_participant_id"
JOIN "race_moves" AS m ON m."sport_event_id" = p."sport_event_id";

INSERT INTO "sport_event_round_match_sides" ("id", "sport_event_id", "sport_event_round_match_id", "side_number", "sport_event_participant_id", "created_at", "updated_at")
SELECT s."side_id", s."sport_event_id", s."match_id", s."side_number", s."sport_event_participant_id", s."created_at", now()
FROM "race_side_moves" AS s;

INSERT INTO "sport_event_round_match_game_side_results" ("sport_event_round_match_id", "sport_event_round_match_game_id", "sport_event_round_match_side_id", "position", "start_position", "status", "rider_name", "home_away", "created_at", "updated_at")
SELECT s."match_id", s."game_id", s."side_id", s."finish_position", s."start_position", s."result_status", s."rider_name", 'NONE', s."created_at", s."updated_at"
FROM "race_side_moves" AS s;

DROP TABLE "race_side_moves";
DROP TABLE "race_moves";
DROP TABLE "sport_event_participant_race_results";

-- A feed id in one sport league at any provider lost its reader with the ranking upload (10b part 2).
DROP INDEX "participant_provider_mappings_sport_league_id_external_id_idx";
