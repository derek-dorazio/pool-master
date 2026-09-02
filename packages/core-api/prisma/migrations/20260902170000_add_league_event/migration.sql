-- plans/124-golf-admin-tournament-management.md §4.3a.
--
-- LeagueEvent is a recurring, named tournament's stable identity ("The
-- Masters," "The US Open") separate from any one year's SportEvent instance
-- of it. Nullable + auto-resolved via find-or-create on
-- (sportLeagueId, name) at tournament creation — never a new admin decision.

-- CreateTable
CREATE TABLE "league_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_league_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "league_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "league_events_sport_league_id_name_key"
  ON "league_events"("sport_league_id", "name");

-- AddForeignKey
ALTER TABLE "league_events"
  ADD CONSTRAINT "league_events_sport_league_id_fkey"
  FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "sport_events" ADD COLUMN "league_event_id" UUID;

-- AddForeignKey
ALTER TABLE "sport_events"
  ADD CONSTRAINT "sport_events_league_event_id_fkey"
  FOREIGN KEY ("league_event_id") REFERENCES "league_events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
