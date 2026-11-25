-- League model slice 7 (#2004): an event's provider id moves onto SportEventProviderMapping, and
-- SportEventSlot says which Season slots an event covers. No existing event gets slots here: a
-- synced event gets its slots when slice 8's sync matches them by provider code, and a test event
-- gets its test slot when it is created on one.

-- CreateTable
CREATE TABLE "sport_event_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "sport_league_season_phase_slot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sport_event_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_event_provider_mappings_sport_league_provider_mapping_idx" ON "sport_event_provider_mappings"("sport_league_provider_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_provider_mappings_provider_id_external_id_key" ON "sport_event_provider_mappings"("provider_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_provider_mappings_sport_event_id_provider_id_key" ON "sport_event_provider_mappings"("sport_event_id", "provider_id");

-- CreateIndex
CREATE INDEX "sport_event_slots_event_idx" ON "sport_event_slots"("sport_event_id", "sport_league_season_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_slots_season_slot_key" ON "sport_event_slots"("sport_league_season_id", "sport_league_season_phase_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_events_id_sport_league_season_id_key" ON "sport_events"("id", "sport_league_season_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_phase_slots_season_id_key" ON "sport_league_season_phase_slots"("sport_league_season_id", "id");

-- AddForeignKey
ALTER TABLE "sport_event_provider_mappings" ADD CONSTRAINT "sport_event_provider_mappings_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_provider_mappings" ADD CONSTRAINT "sport_event_provider_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_provider_mappings" ADD CONSTRAINT "sport_event_provider_mappings_sport_league_provider_mappin_fkey" FOREIGN KEY ("sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_event_fkey" FOREIGN KEY ("sport_event_id", "sport_league_season_id") REFERENCES "sport_events"("id", "sport_league_season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_season_slot_fkey" FOREIGN KEY ("sport_league_season_id", "sport_league_season_phase_slot_id") REFERENCES "sport_league_season_phase_slots"("sport_league_season_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (#2004): every event linked to a provider for scores keeps its provider id on a mapping
-- row, under its league's mapping to that provider (the selected one first). The events carried the
-- provider's adapter id (`balldontlie`), the lower-case Provider code. Admin placeholders
-- (`manual-admin`) and unlinked events get no mapping: they are not synced.
INSERT INTO "sport_event_provider_mappings" ("sport_event_id", "provider_id", "sport_league_provider_mapping_id", "external_id", "updated_at")
SELECT DISTINCT ON (e."id") e."id", p."id", m."id", e."external_id", CURRENT_TIMESTAMP
FROM "sport_events" e
JOIN "event_series" es ON es."id" = e."event_series_id"
JOIN "sport_leagues" l ON l."id" = es."sport_league_id"
JOIN "providers" p ON lower(p."code"::text) = e."provider_id"
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = l."id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id" AND pl."provider_id" = p."id"
WHERE e."sync_scope" = 'SCORES_ONLY'
ORDER BY e."id", (m."id" = l."selected_provider_mapping_id") DESC, m."created_at";

-- DropIndex
DROP INDEX "sport_events_provider_id_external_id_key";

-- AlterTable
-- `metadata` drops too: nothing wrote an event's metadata since the sync stopped storing it, and
-- nothing read it (#2004). The feed's tour and season words have their homes in the provider
-- league and the Season.
ALTER TABLE "sport_events" DROP COLUMN "external_id",
DROP COLUMN "metadata",
DROP COLUMN "provider_id",
DROP COLUMN "sync_scope";

-- DropEnum
DROP TYPE "PrismaSportEventSyncScope";
