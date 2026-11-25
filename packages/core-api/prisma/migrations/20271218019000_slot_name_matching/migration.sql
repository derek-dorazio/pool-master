-- League model slice 12 (#2011): open-phase tournaments match their Season slot by name.

-- Two finding kinds: a tournament whose normalized name no NAME_PATTERN mapping matches (INFO,
-- offering "link to existing"), and one whose name matches more than one slot, or a slot another
-- tournament already has (ERROR).
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_NAME_UNMATCHED';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_NAME_AMBIGUOUS';

-- A slot keeps one mapping per provider, except NAME_PATTERN: "link to existing" adds a
-- tournament's other names as more patterns of its slot. The plain index keeps the lookup Prisma
-- declares; the partial unique index keeps every other match type at one row per slot and provider.
DROP INDEX "sport_league_phase_slot_provider_mappings_slot_provider_key";
CREATE INDEX "sport_league_phase_slot_provider_mappings_slot_provider_idx" ON "sport_league_phase_slot_provider_mappings"("sport_league_phase_slot_id", "sport_league_provider_mapping_id");
CREATE UNIQUE INDEX "sport_league_phase_slot_provider_mappings_one_per_provider" ON "sport_league_phase_slot_provider_mappings"("sport_league_phase_slot_id", "sport_league_provider_mapping_id") WHERE "match_type" <> 'NAME_PATTERN';

-- The target of a provider link's composite key, which keeps a link on its slot's own league.
CREATE UNIQUE INDEX "sport_league_season_phase_slots_league_id_key" ON "sport_league_season_phase_slots"("sport_league_id", "id");

-- The provider's tournament each Season slot was linked to by its name: from then on the
-- tournament matches by this code, whatever it is called. Nothing is backfilled: no Season has a
-- tournament slot yet (they are created when their first tournament matches).
CREATE TABLE "season_slot_provider_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_phase_slot_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_value" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "season_slot_provider_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "season_slot_provider_links_slot_idx" ON "season_slot_provider_links"("sport_league_id", "sport_league_season_phase_slot_id");
CREATE UNIQUE INDEX "season_slot_provider_links_slot_provider_key" ON "season_slot_provider_links"("sport_league_season_phase_slot_id", "sport_league_provider_mapping_id");
CREATE UNIQUE INDEX "season_slot_provider_links_value_key" ON "season_slot_provider_links"("sport_league_provider_mapping_id", "provider_value");

ALTER TABLE "season_slot_provider_links" ADD CONSTRAINT "season_slot_provider_links_slot_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_phase_slot_id") REFERENCES "sport_league_season_phase_slots"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "season_slot_provider_links" ADD CONSTRAINT "season_slot_provider_links_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
