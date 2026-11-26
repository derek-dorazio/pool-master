-- Match sides, Game side results and their period scores (#2046). A match's two sides become rows,
-- side 1 the old away team and side 2 the old home team; each Game holds each side's score and
-- where it played; period scores are each period's own points. The match's home and away columns,
-- its scores, shoot-out scores, winner, spread and result source go, as does the old per-match
-- period score table. A game pick names the side it picked.

-- CreateEnum
CREATE TYPE "PrismaMatchSideOutcome" AS ENUM ('PENDING', 'WON', 'LOST', 'TIED');

-- CreateEnum
CREATE TYPE "PrismaHomeAway" AS ENUM ('HOME', 'AWAY', 'NONE');

-- CreateEnum
CREATE TYPE "PrismaPeriodKind" AS ENUM ('REGULAR', 'OVERTIME', 'SHOOTOUT');

-- CreateTable
CREATE TABLE "sport_event_round_match_sides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_event_round_match_id" UUID NOT NULL,
    "side_number" INTEGER NOT NULL,
    "sport_event_participant_id" UUID,
    "spread" DECIMAL(4,1),
    "outcome" "PrismaMatchSideOutcome" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_sides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sport_event_round_match_sides_side_number_check" CHECK ("side_number" IN (1, 2)),
    CONSTRAINT "sport_event_round_match_sides_spread_side_one_check" CHECK ("spread" IS NULL OR "side_number" = 1),
    CONSTRAINT "sport_event_round_match_sides_spread_half_points_check" CHECK ("spread" IS NULL OR "spread" * 2 = trunc("spread" * 2))
);

-- CreateTable
CREATE TABLE "sport_event_round_match_game_side_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_round_match_id" UUID NOT NULL,
    "sport_event_round_match_game_id" UUID NOT NULL,
    "sport_event_round_match_side_id" UUID NOT NULL,
    "score" INTEGER,
    "home_away" "PrismaHomeAway" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_game_side_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sport_event_round_match_game_side_results_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

-- CreateTable
CREATE TABLE "sport_event_round_match_game_side_result_period_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_round_match_game_side_result_id" UUID NOT NULL,
    "kind" "PrismaPeriodKind" NOT NULL,
    "period_number" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_game_side_result_period_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sport_event_round_match_game_side_result_period_scores_check" CHECK ("period_number" >= 1 AND "score" >= 0 AND ("kind" <> 'SHOOTOUT' OR "period_number" = 1))
);

-- CreateIndex
CREATE INDEX "sport_event_round_match_sides_sport_event_id_sport_event_pa_idx" ON "sport_event_round_match_sides"("sport_event_id", "sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_sides_sport_event_round_match_id_si_key" ON "sport_event_round_match_sides"("sport_event_round_match_id", "side_number");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_sides_sport_event_round_match_id_sp_key" ON "sport_event_round_match_sides"("sport_event_round_match_id", "sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_sides_match_id_key" ON "sport_event_round_match_sides"("sport_event_round_match_id", "id");

-- CreateIndex
CREATE INDEX "sport_event_round_match_game_side_results_sport_event_round_idx" ON "sport_event_round_match_game_side_results"("sport_event_round_match_id", "sport_event_round_match_side_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_game_side_results_sport_event_round_key" ON "sport_event_round_match_game_side_results"("sport_event_round_match_game_id", "sport_event_round_match_side_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_game_side_result_period_scores_key" ON "sport_event_round_match_game_side_result_period_scores"("sport_event_round_match_game_side_result_id", "kind", "period_number");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participants_event_id_key" ON "sport_event_participants"("sport_event_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_games_match_id_key" ON "sport_event_round_match_games"("sport_event_round_match_id", "id");

-- AddForeignKey
ALTER TABLE "sport_event_round_match_sides" ADD CONSTRAINT "sport_event_round_match_sides_match_fkey" FOREIGN KEY ("sport_event_id", "sport_event_round_match_id") REFERENCES "sport_event_round_matches"("sport_event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_sides" ADD CONSTRAINT "sport_event_round_match_sides_participant_fkey" FOREIGN KEY ("sport_event_id", "sport_event_participant_id") REFERENCES "sport_event_participants"("sport_event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_side_results" ADD CONSTRAINT "sport_event_round_match_game_side_results_game_fkey" FOREIGN KEY ("sport_event_round_match_id", "sport_event_round_match_game_id") REFERENCES "sport_event_round_match_games"("sport_event_round_match_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_side_results" ADD CONSTRAINT "sport_event_round_match_game_side_results_side_fkey" FOREIGN KEY ("sport_event_round_match_id", "sport_event_round_match_side_id") REFERENCES "sport_event_round_match_sides"("sport_event_round_match_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_side_result_period_scores" ADD CONSTRAINT "sport_event_round_match_game_side_result_period_scores_spo_fkey" FOREIGN KEY ("sport_event_round_match_game_side_result_id") REFERENCES "sport_event_round_match_game_side_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each match's two sides: side 1 the away team, side 2 the home team, either empty until known.
-- The spread moves to side 1, from the away team's view. The outcome comes from the winner: a
-- COMPLETED match without one was a draw.
INSERT INTO "sport_event_round_match_sides" ("sport_event_id", "sport_event_round_match_id", "side_number", "sport_event_participant_id", "spread", "outcome", "updated_at")
SELECT m."sport_event_id", m."id", s."side_number",
       CASE s."side_number" WHEN 1 THEN m."away_sport_event_participant_id" ELSE m."home_sport_event_participant_id" END,
       CASE s."side_number" WHEN 1 THEN -m."home_spread" END,
       (CASE
         WHEN m."status" <> 'COMPLETED' THEN 'PENDING'
         WHEN m."winner_side" IS NULL THEN 'TIED'
         WHEN m."winner_side" = (CASE s."side_number" WHEN 1 THEN 'AWAY' ELSE 'HOME' END)::"PrismaMatchSide" THEN 'WON'
         ELSE 'LOST'
       END)::"PrismaMatchSideOutcome",
       now()
FROM "sport_event_round_matches" m
CROSS JOIN (VALUES (1), (2)) AS s("side_number");

-- Each Game's two side results, with the Game's own score and where each side played.
INSERT INTO "sport_event_round_match_game_side_results" ("sport_event_round_match_id", "sport_event_round_match_game_id", "sport_event_round_match_side_id", "score", "home_away", "updated_at")
SELECT g."sport_event_round_match_id", g."id", s."id",
       CASE s."side_number" WHEN 1 THEN g."away_score" ELSE g."home_score" END,
       (CASE WHEN m."is_neutral_site" THEN 'NONE' WHEN s."side_number" = 1 THEN 'AWAY' ELSE 'HOME' END)::"PrismaHomeAway",
       now()
FROM "sport_event_round_match_games" g
JOIN "sport_event_round_matches" m ON m."id" = g."sport_event_round_match_id"
JOIN "sport_event_round_match_sides" s ON s."sport_event_round_match_id" = g."sport_event_round_match_id";

-- Period scores move to Game 1's side results as each period's own points: the old rows are the
-- running score at the end of every period but the last, so each is the difference from the one
-- before, and the last period (overtime included) is what the final score adds to the last row.
INSERT INTO "sport_event_round_match_game_side_result_period_scores" ("sport_event_round_match_game_side_result_id", "kind", "period_number", "score", "updated_at")
SELECT r."id", 'REGULAR', p."period_number",
       CASE s."side_number" WHEN 1 THEN p."away_score" - COALESCE(p."previous_away", 0) ELSE p."home_score" - COALESCE(p."previous_home", 0) END,
       now()
FROM (
  SELECT *, LAG("home_score") OVER w AS "previous_home", LAG("away_score") OVER w AS "previous_away"
  FROM "sport_event_match_period_scores"
  WINDOW w AS (PARTITION BY "sport_event_round_match_id" ORDER BY "period_number")
) p
JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = p."sport_event_round_match_id" AND g."game_number" = 1
JOIN "sport_event_round_match_sides" s ON s."sport_event_round_match_id" = p."sport_event_round_match_id"
JOIN "sport_event_round_match_game_side_results" r ON r."sport_event_round_match_game_id" = g."id" AND r."sport_event_round_match_side_id" = s."id";

INSERT INTO "sport_event_round_match_game_side_result_period_scores" ("sport_event_round_match_game_side_result_id", "kind", "period_number", "score", "updated_at")
SELECT r."id", 'REGULAR', p."period_number" + 1,
       CASE s."side_number" WHEN 1 THEN m."away_score" - p."away_score" ELSE m."home_score" - p."home_score" END,
       now()
FROM (
  SELECT DISTINCT ON ("sport_event_round_match_id") * FROM "sport_event_match_period_scores"
  ORDER BY "sport_event_round_match_id", "period_number" DESC
) p
JOIN "sport_event_round_matches" m ON m."id" = p."sport_event_round_match_id"
JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = m."id" AND g."game_number" = 1
JOIN "sport_event_round_match_sides" s ON s."sport_event_round_match_id" = m."id"
JOIN "sport_event_round_match_game_side_results" r ON r."sport_event_round_match_game_id" = g."id" AND r."sport_event_round_match_side_id" = s."id"
WHERE m."status" = 'COMPLETED' AND m."home_score" IS NOT NULL AND m."away_score" IS NOT NULL;

-- A shoot-out is one SHOOTOUT row on Game 1, each side's kicks scored.
INSERT INTO "sport_event_round_match_game_side_result_period_scores" ("sport_event_round_match_game_side_result_id", "kind", "period_number", "score", "updated_at")
SELECT r."id", 'SHOOTOUT', 1,
       CASE s."side_number" WHEN 1 THEN m."away_shootout_score" ELSE m."home_shootout_score" END,
       now()
FROM "sport_event_round_matches" m
JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = m."id" AND g."game_number" = 1
JOIN "sport_event_round_match_sides" s ON s."sport_event_round_match_id" = m."id"
JOIN "sport_event_round_match_game_side_results" r ON r."sport_event_round_match_game_id" = g."id" AND r."sport_event_round_match_side_id" = s."id"
WHERE m."home_shootout_score" IS NOT NULL AND m."away_shootout_score" IS NOT NULL;

-- A game pick names the side its team plays. A team pick whose team plays neither side is no
-- longer a pick of the game, and goes.
ALTER TABLE "contest_entry_match_predictions" ADD COLUMN "sport_event_round_match_side_id" UUID;

UPDATE "contest_entry_match_predictions" p
SET "sport_event_round_match_side_id" = s."id"
FROM "sport_event_round_match_sides" s
WHERE s."sport_event_round_match_id" = p."sport_event_round_match_id" AND s."sport_event_participant_id" = p."sport_event_participant_id";

DELETE FROM "contest_entry_match_predictions" WHERE "predicted_result" = 'TEAM' AND "sport_event_round_match_side_id" IS NULL;

-- DropForeignKey
ALTER TABLE "contest_entry_match_predictions" DROP CONSTRAINT "contest_entry_match_predictions_sport_event_participant_id_fkey";

-- DropIndex
DROP INDEX "contest_entry_match_predictions_sport_event_participant_id_idx";

-- DropIndex
DROP INDEX "contest_entry_match_predictions_sport_event_round_match_id_idx";

-- AlterTable: the old team check goes with its column.
ALTER TABLE "contest_entry_match_predictions" DROP COLUMN "sport_event_participant_id";

ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_side_with_team_result" CHECK (("predicted_result" = 'TEAM') = ("sport_event_round_match_side_id" IS NOT NULL));

-- CreateIndex
CREATE INDEX "contest_entry_match_predictions_sport_event_round_match_id__idx" ON "contest_entry_match_predictions"("sport_event_round_match_id", "sport_event_round_match_side_id");

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_side_fkey" FOREIGN KEY ("sport_event_round_match_id", "sport_event_round_match_side_id") REFERENCES "sport_event_round_match_sides"("sport_event_round_match_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Advancement names the next match's side by number: HOME was side 2, AWAY side 1.
ALTER TABLE "sport_event_round_matches" ADD COLUMN "advances_to_side_number" INTEGER;

UPDATE "sport_event_round_matches" SET "advances_to_side_number" = CASE "advances_to_side" WHEN 'HOME' THEN 2 ELSE 1 END
WHERE "advances_to_side" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "sport_event_round_matches" DROP CONSTRAINT "sport_event_round_matches_away_sport_event_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "sport_event_round_matches" DROP CONSTRAINT "sport_event_round_matches_home_sport_event_participant_id_fkey";

-- DropIndex
DROP INDEX "sport_event_round_matches_advances_to_match_id_advances_to__key";

-- DropIndex
DROP INDEX "sport_event_round_matches_away_sport_event_participant_id_idx";

-- DropIndex
DROP INDEX "sport_event_round_matches_home_sport_event_participant_id_idx";

-- AlterTable: the checks on the dropped columns go with them.
ALTER TABLE "sport_event_round_matches" DROP COLUMN "advances_to_side",
DROP COLUMN "away_score",
DROP COLUMN "away_shootout_score",
DROP COLUMN "away_sport_event_participant_id",
DROP COLUMN "home_score",
DROP COLUMN "home_shootout_score",
DROP COLUMN "home_sport_event_participant_id",
DROP COLUMN "home_spread",
DROP COLUMN "result_source",
DROP COLUMN "winner_side";

ALTER TABLE "sport_event_round_matches" ADD CONSTRAINT "sport_event_round_matches_advances_to_side_number_check" CHECK (("advances_to_match_id" IS NULL) = ("advances_to_side_number" IS NULL) AND ("advances_to_side_number" IS NULL OR "advances_to_side_number" IN (1, 2)));

ALTER TABLE "sport_event_round_matches" ADD CONSTRAINT "sport_event_round_matches_ending_check" CHECK ("ending" = 'PLAYED' OR "status" = 'COMPLETED');

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_matches_advances_to_match_id_advances_to__key" ON "sport_event_round_matches"("advances_to_match_id", "advances_to_side_number");

-- AlterTable
ALTER TABLE "sport_event_round_match_games" DROP COLUMN "away_score",
DROP COLUMN "home_score",
DROP COLUMN "winner_side";

-- DropTable
DROP TABLE "sport_event_match_period_scores";

-- DropEnum
DROP TYPE "PrismaMatchResultSource";

-- DropEnum
DROP TYPE "PrismaMatchSide";
