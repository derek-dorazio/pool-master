-- CreateEnum
CREATE TYPE "PrismaGolfLiveStatus" AS ENUM ('active', 'in-progress', 'complete', 'withdrawn', 'missed-cut');

-- AlterTable
ALTER TABLE "sport_event_participant_golf_rounds"
  ADD COLUMN "thru" INTEGER;

-- CreateTable
CREATE TABLE "sport_event_participant_golf_standings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_participant_id" UUID NOT NULL,
  "event_score_to_par" INTEGER NOT NULL,
  "event_strokes" INTEGER NOT NULL,
  "current_round" INTEGER,
  "current_round_thru" INTEGER,
  "status" "PrismaGolfLiveStatus" NOT NULL DEFAULT 'active',
  "position" INTEGER,
  "display_position" VARCHAR(20),
  "as_of" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "sport_event_participant_golf_standings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sep_golf_standings_sep_id_key"
  ON "sport_event_participant_golf_standings"("sport_event_participant_id");

-- CreateIndex
CREATE INDEX "sep_golf_standings_status_idx"
  ON "sport_event_participant_golf_standings"("status");

-- CreateIndex
CREATE INDEX "sep_golf_standings_position_idx"
  ON "sport_event_participant_golf_standings"("position");

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_standings"
  ADD CONSTRAINT "sep_golf_standings_sep_id_fkey"
  FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
