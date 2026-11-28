-- League model 22 (#2026): a Game's box score, one row per Game, player and SportStat code, and
-- the two findings its read and writer raise. The table is new, so QA has no rows to move.

-- CreateEnum
CREATE TYPE "PrismaSportStat" AS ENUM ('PASSING_TOUCHDOWNS', 'RUSHING_TOUCHDOWNS', 'RECEIVING_TOUCHDOWNS', 'RECEPTIONS', 'PASSING_YARDS', 'RUSHING_YARDS', 'RECEIVING_YARDS', 'POINTS', 'REBOUNDS', 'ASSISTS', 'GOALS', 'SHOTS_ON_GOAL', 'SHOTS_ON_TARGET', 'TOTAL_BASES', 'RUNS', 'RUNS_BATTED_IN', 'WALKS', 'STOLEN_BASES');

-- AlterEnum

ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'PROVIDER_PLAN_HAS_NO_STATS';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'BOX_SCORE_PLAYER_NOT_IN_GAME';

-- CreateTable
CREATE TABLE "sport_event_round_match_game_player_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_event_round_match_id" UUID NOT NULL,
    "sport_event_round_match_game_id" UUID NOT NULL,
    "sport_event_round_match_side_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "stat" "PrismaSportStat" NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_game_player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_event_round_match_game_player_stats_player_idx" ON "sport_event_round_match_game_player_stats"("sport_league_id", "participant_id");

-- CreateIndex
CREATE INDEX "sport_event_round_match_game_player_stats_game_idx" ON "sport_event_round_match_game_player_stats"("sport_event_round_match_id", "sport_event_round_match_game_id");

-- CreateIndex
CREATE INDEX "sport_event_round_match_game_player_stats_side_idx" ON "sport_event_round_match_game_player_stats"("sport_event_round_match_id", "sport_event_round_match_side_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_game_player_stats_game_player_stat_key" ON "sport_event_round_match_game_player_stats"("sport_event_round_match_game_id", "participant_id", "stat");

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_player_stats" ADD CONSTRAINT "sport_event_round_match_game_player_stats_game_fkey" FOREIGN KEY ("sport_event_round_match_id", "sport_event_round_match_game_id") REFERENCES "sport_event_round_match_games"("sport_event_round_match_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_player_stats" ADD CONSTRAINT "sport_event_round_match_game_player_stats_side_fkey" FOREIGN KEY ("sport_event_round_match_id", "sport_event_round_match_side_id") REFERENCES "sport_event_round_match_sides"("sport_event_round_match_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_player_stats" ADD CONSTRAINT "sport_event_round_match_game_player_stats_player_fkey" FOREIGN KEY ("sport_league_id", "participant_id") REFERENCES "participants"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

