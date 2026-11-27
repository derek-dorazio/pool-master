-- League model 21 part A (#2025): a player's team and position move onto a roster row per Season
-- and player (sport_league_season_participant_teams), written by the roster sync. A team's
-- abbreviation becomes a participant column, written by the sync from the feed.
--
-- participants.role and participants.team_affiliation are dropped without a carry-over: no feed
-- or test-data loader writes either, so only free text an admin typed can be in them, and a
-- roster row names its team and position by id, which free text cannot give without matching on
-- names. The roster sync fills the roster rows.
-- DropIndex
DROP INDEX "participants_team_affiliation_trgm_idx";

-- AlterTable
ALTER TABLE "participants" DROP COLUMN "role",
DROP COLUMN "team_affiliation",
ADD COLUMN     "abbreviation" VARCHAR(10);

-- CreateTable
CREATE TABLE "sport_league_season_participant_teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "team_participant_id" UUID NOT NULL,
    "sport_league_position_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_participant_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_league_season_participant_teams_player_idx" ON "sport_league_season_participant_teams"("sport_league_id", "participant_id");

-- CreateIndex
CREATE INDEX "sport_league_season_participant_teams_team_idx" ON "sport_league_season_participant_teams"("sport_league_id", "team_participant_id");

-- CreateIndex
CREATE INDEX "sport_league_season_participant_teams_season_idx" ON "sport_league_season_participant_teams"("sport_league_id", "sport_league_season_id");

-- CreateIndex
CREATE INDEX "sport_league_season_participant_teams_position_idx" ON "sport_league_season_participant_teams"("sport_league_id", "sport_league_position_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_participant_teams_season_player_key" ON "sport_league_season_participant_teams"("sport_league_season_id", "participant_id");

-- CreateIndex
CREATE INDEX "participants_abbreviation_trgm_idx" ON "participants" USING GIN ("abbreviation" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "participants_sport_league_id_id_key" ON "participants"("sport_league_id", "id");

-- AddForeignKey
ALTER TABLE "sport_league_season_participant_teams" ADD CONSTRAINT "sport_league_season_participant_teams_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_participant_teams" ADD CONSTRAINT "sport_league_season_participant_teams_player_fkey" FOREIGN KEY ("sport_league_id", "participant_id") REFERENCES "participants"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_participant_teams" ADD CONSTRAINT "sport_league_season_participant_teams_team_fkey" FOREIGN KEY ("sport_league_id", "team_participant_id") REFERENCES "participants"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_participant_teams" ADD CONSTRAINT "sport_league_season_participant_teams_position_fkey" FOREIGN KEY ("sport_league_id", "sport_league_position_id") REFERENCES "sport_league_positions"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

