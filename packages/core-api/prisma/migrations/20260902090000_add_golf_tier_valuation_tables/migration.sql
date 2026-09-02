-- plans/124-golf-admin-tournament-management.md §4.5/§4.5a.
--
-- Event-owned golf tier + valuation tables. SportEventParticipantValuation
-- (the legacy per-contest tier/price table) is NOT dropped here — drafts/routes.ts
-- still reads it as the live draft room's tier/price source; that rewiring and
-- table drop is sequenced into a later slice (§4.6b).

-- CreateEnum
CREATE TYPE "PrismaGolfValuationSource" AS ENUM ('AUTO_ODDS', 'AUTO_WORLD_RANK', 'MANUAL');

-- CreateTable
CREATE TABLE "sport_event_golf_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_id" UUID NOT NULL,
  "tier_key" VARCHAR(50) NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  "tier_number" INTEGER NOT NULL,
  "default_pick_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "sport_event_golf_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_golf_valuations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_participant_id" UUID NOT NULL,
  "sport_event_golf_tier_id" UUID,
  "tier_order_index" INTEGER,
  "tier_assigned_source" "PrismaGolfValuationSource",
  "price" DECIMAL(10,2),
  "price_assigned_source" "PrismaGolfValuationSource",
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "sport_event_participant_golf_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_golf_tiers_sport_event_id_tier_key_key"
  ON "sport_event_golf_tiers"("sport_event_id", "tier_key");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_golf_tiers_sport_event_id_tier_number_key"
  ON "sport_event_golf_tiers"("sport_event_id", "tier_number");

-- CreateIndex
CREATE UNIQUE INDEX "sep_golf_valuations_sep_id_key"
  ON "sport_event_participant_golf_valuations"("sport_event_participant_id");

-- CreateIndex
CREATE INDEX "sep_golf_valuations_tier_id_order_idx"
  ON "sport_event_participant_golf_valuations"("sport_event_golf_tier_id", "tier_order_index");

-- AddForeignKey
ALTER TABLE "sport_event_golf_tiers"
  ADD CONSTRAINT "sport_event_golf_tiers_sport_event_id_fkey"
  FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_valuations"
  ADD CONSTRAINT "sep_golf_valuations_sep_id_fkey"
  FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_valuations"
  ADD CONSTRAINT "sep_golf_valuations_tier_id_fkey"
  FOREIGN KEY ("sport_event_golf_tier_id") REFERENCES "sport_event_golf_tiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
