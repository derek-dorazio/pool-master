-- #2008 (10b part 3b): a golf round is one FIELD Match in its round, with every golfer who
-- played it as a side and one Game. Each golfer's round moves from sport_event_participant_rounds
-- and its golf row onto that Game's side results; the golf standing's totals move onto the
-- standing itself. A round is COMPLETED once every golfer in it has finished it.

ALTER TABLE "sport_event_round_match_game_side_results"
  ADD COLUMN "score_to_par" INTEGER,
  ADD COLUMN "periods_completed" INTEGER,
  ADD CONSTRAINT "sport_event_round_match_game_side_results_periods_completed_check" CHECK ("periods_completed" IS NULL OR "periods_completed" >= 0);

ALTER TABLE "sport_event_participant_standings"
  ADD COLUMN "total" INTEGER,
  ADD COLUMN "score_to_par" INTEGER;

UPDATE "sport_event_participant_standings" AS s
SET "total" = g."event_strokes", "score_to_par" = g."event_score_to_par"
FROM "sport_event_participant_golf_standings" AS g
WHERE g."standing_id" = s."id";

-- Each round with a golfer's score: its slot's holes, and whether every golfer has finished it.
CREATE TEMP TABLE "golf_round_moves" AS
SELECT
  r."sport_event_id",
  r."id" AS "sport_event_round_id",
  r."sport_event_slot_id",
  d."period_count" AS "holes",
  bool_and(pr."status" <> 'IN_PROGRESS') AS "is_finished",
  max(pr."completed_at") AS "last_completed_at",
  gen_random_uuid() AS "match_id",
  gen_random_uuid() AS "game_id"
FROM "sport_event_participant_rounds" AS pr
JOIN "sport_event_rounds" AS r ON r."id" = pr."sport_event_round_id"
JOIN "sport_event_slots" AS es ON es."id" = r."sport_event_slot_id"
JOIN "sport_league_season_competition_slots" AS ss ON ss."id" = es."sport_league_season_competition_slot_id"
JOIN "sport_league_competition_slots" AS d ON d."id" = ss."sport_league_competition_slot_id"
GROUP BY r."sport_event_id", r."id", r."sport_event_slot_id", d."period_count";

INSERT INTO "sport_event_round_matches" ("id", "sport_event_id", "sport_event_round_id", "match_number", "status", "updated_at")
SELECT
  m."match_id",
  m."sport_event_id",
  m."sport_event_round_id",
  COALESCE((SELECT max(x."match_number") FROM "sport_event_round_matches" AS x WHERE x."sport_event_round_id" = m."sport_event_round_id"), 0) + 1,
  CASE WHEN m."is_finished" THEN 'COMPLETED' ELSE 'IN_PROGRESS' END::"PrismaMatchStatus",
  now()
FROM "golf_round_moves" AS m;

INSERT INTO "sport_event_round_match_games" ("id", "sport_event_id", "sport_event_round_match_id", "sport_event_slot_id", "game_number", "status", "completed_at", "updated_at")
SELECT
  m."game_id",
  m."sport_event_id",
  m."match_id",
  m."sport_event_slot_id",
  1,
  CASE WHEN m."is_finished" THEN 'COMPLETED' ELSE 'IN_PROGRESS' END::"PrismaMatchStatus",
  CASE WHEN m."is_finished" THEN m."last_completed_at" ELSE NULL END,
  now()
FROM "golf_round_moves" AS m;

-- Sides numbered by score to par, then field row, so the number is stable. A golfer still on
-- the course has no status; a missed cut is the standing's (ELIMINATED), so the round itself
-- was finished.
CREATE TEMP TABLE "golf_side_moves" AS
SELECT
  gen_random_uuid() AS "side_id",
  m."sport_event_id",
  m."match_id",
  m."game_id",
  pr."sport_event_participant_id",
  pr."created_at",
  pr."updated_at",
  g."strokes",
  g."score_to_par",
  CASE WHEN pr."status" = 'IN_PROGRESS' THEN g."thru" ELSE COALESCE(g."thru", m."holes") END AS "periods_completed",
  CASE pr."status"
    WHEN 'COMPLETED' THEN 'FINISHED'
    WHEN 'MISSED_CUT' THEN 'FINISHED'
    WHEN 'DNF' THEN 'DID_NOT_FINISH'
    WHEN 'DSQ' THEN 'DISQUALIFIED'
  END::"GameSideStatus" AS "status",
  row_number() OVER (PARTITION BY m."match_id" ORDER BY g."score_to_par" NULLS LAST, pr."sport_event_participant_id") AS "side_number"
FROM "sport_event_participant_rounds" AS pr
JOIN "golf_round_moves" AS m ON m."sport_event_round_id" = pr."sport_event_round_id"
LEFT JOIN "sport_event_participant_golf_rounds" AS g ON g."participant_round_id" = pr."id";

INSERT INTO "sport_event_round_match_sides" ("id", "sport_event_id", "sport_event_round_match_id", "side_number", "sport_event_participant_id", "created_at", "updated_at")
SELECT s."side_id", s."sport_event_id", s."match_id", s."side_number", s."sport_event_participant_id", s."created_at", now()
FROM "golf_side_moves" AS s;

INSERT INTO "sport_event_round_match_game_side_results" ("sport_event_round_match_id", "sport_event_round_match_game_id", "sport_event_round_match_side_id", "score", "score_to_par", "periods_completed", "status", "home_away", "created_at", "updated_at")
SELECT s."match_id", s."game_id", s."side_id", s."strokes", s."score_to_par", s."periods_completed", s."status", 'NONE', s."created_at", s."updated_at"
FROM "golf_side_moves" AS s;

DROP TABLE "golf_side_moves";
DROP TABLE "golf_round_moves";
DROP TABLE "sport_event_participant_golf_rounds";
DROP TABLE "sport_event_participant_rounds";
DROP TABLE "sport_event_participant_golf_standings";
DROP TYPE "PrismaParticipantRoundStatus";
