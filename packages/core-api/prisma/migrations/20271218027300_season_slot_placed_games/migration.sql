-- League model slice 13b (#2154): the provider's games the events sync placed in each Season slot,
-- so a field sync gives an event only its slots' games and their teams. Placement is worked out
-- once, by the sync; a game sits in one slot per provider mapping.
-- CreateTable
CREATE TABLE "sport_league_season_competition_slot_game_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_competition_slot_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_competition_slot_game_provider_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "season_slot_game_provider_mappings_slot_idx" ON "sport_league_season_competition_slot_game_provider_mappings"("sport_league_id", "sport_league_season_competition_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "season_slot_game_provider_mappings_game_key" ON "sport_league_season_competition_slot_game_provider_mappings"("sport_league_provider_mapping_id", "external_id");

-- AddForeignKey
ALTER TABLE "sport_league_season_competition_slot_game_provider_mappings" ADD CONSTRAINT "season_slot_game_provider_mappings_slot_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_competition_slot_id") REFERENCES "sport_league_season_competition_slots"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_competition_slot_game_provider_mappings" ADD CONSTRAINT "season_slot_game_provider_mappings_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

