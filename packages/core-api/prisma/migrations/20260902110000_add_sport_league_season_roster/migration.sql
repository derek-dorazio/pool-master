-- plans/124-golf-admin-tournament-management.md §4.2/§4.2a/§4.3.
--
-- Adds the cross-sport SportLeague/roster substrate and retargets the
-- previously-dormant Season table onto it (zero existing rows/callers —
-- confirmed by grep before writing this migration, a genuine redesign of a
-- dormant column, not a breaking data migration).
--
-- SportEvent.seasonId is added NULLABLE, not NOT NULL as plans/124 §4.3's
-- end-state description calls for: that reasoning assumes admin-authored
-- creation (a later slice) is the only SportEvent write path and the
-- sync-created-event path (plans/125) has been retired. Neither is true yet
-- — ingestion-persistence.ts's sportEvent.upsert() is still the only
-- SportEvent-creating call site in this codebase today, and it has no season
-- to supply. Making this column required now would break every live sync
-- cycle. Tightens to NOT NULL once that path is actually retired.

-- DropForeignKey
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_sport_id_fkey";

-- AlterTable: seasons — drop sport_id, add sport_league_id + is_active
-- (added nullable first since sport_leagues doesn't exist until the next
-- statement; backfilled to NOT NULL below once the table + FK exist).
ALTER TABLE "seasons"
  DROP COLUMN "sport_id",
  ADD COLUMN "sport_league_id" UUID,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "sport_leagues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "match_keyword" VARCHAR(255),
  "current_season_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "sport_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_league_affiliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "participant_id" UUID NOT NULL,
  "sport_league_id" UUID NOT NULL,
  "world_ranking" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "participant_league_affiliations_pkey" PRIMARY KEY ("id")
);

-- AlterTable: seasons.sport_league_id now required (table has zero rows —
-- see note above — so this NOT NULL flip is safe with no backfill).
ALTER TABLE "seasons" ALTER COLUMN "sport_league_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "sport_events" ADD COLUMN "season_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sport_leagues_sport_id_name_key" ON "sport_leagues"("sport_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sport_leagues_current_season_id_key" ON "sport_leagues"("current_season_id");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_sport_league_id_year_key" ON "seasons"("sport_league_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "participant_league_affiliations_participant_id_sport_leag_key"
  ON "participant_league_affiliations"("participant_id", "sport_league_id");

-- CreateIndex
CREATE INDEX "participant_league_affiliations_sport_league_id_world_ran_idx"
  ON "participant_league_affiliations"("sport_league_id", "world_ranking");

-- AddForeignKey
ALTER TABLE "sport_leagues"
  ADD CONSTRAINT "sport_leagues_sport_id_fkey"
  FOREIGN KEY ("sport_id") REFERENCES "sports"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons"
  ADD CONSTRAINT "seasons_sport_league_id_fkey"
  FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: circular with sport_leagues.current_season_id — added last,
-- once both tables exist.
ALTER TABLE "sport_leagues"
  ADD CONSTRAINT "sport_leagues_current_season_id_fkey"
  FOREIGN KEY ("current_season_id") REFERENCES "seasons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_league_affiliations"
  ADD CONSTRAINT "participant_league_affiliations_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_league_affiliations"
  ADD CONSTRAINT "participant_league_affiliations_sport_league_id_fkey"
  FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_events"
  ADD CONSTRAINT "sport_events_season_id_fkey"
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
