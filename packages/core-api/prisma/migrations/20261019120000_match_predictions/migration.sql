-- Prediction contests (#716): a contest can be PREDICTION, played with the PICK_EM selection
-- type, and an entry picks the winner of each game in contest_entry_match_predictions.

-- AlterEnum
ALTER TYPE "PrismaContestFormat" ADD VALUE 'PREDICTION';

-- AlterEnum
ALTER TYPE "PrismaSelectionType" ADD VALUE 'PICK_EM';

-- CreateTable
CREATE TABLE "contest_entry_match_predictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_entry_id" UUID NOT NULL,
    "sport_event_match_id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "confidence" INTEGER,
    "picked_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_match_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contest_entry_match_predictions_sport_event_match_id_idx" ON "contest_entry_match_predictions"("sport_event_match_id");

-- CreateIndex
CREATE INDEX "contest_entry_match_predictions_sport_event_participant_id_idx" ON "contest_entry_match_predictions"("sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_match_predictions_contest_entry_id_sport_even_key" ON "contest_entry_match_predictions"("contest_entry_id", "sport_event_match_id");

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_sport_event_match_id_fkey" FOREIGN KEY ("sport_event_match_id") REFERENCES "sport_event_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_sport_event_participant_id_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A confidence value is 1 or more; that each is used once in a week is checked at submit.
ALTER TABLE "contest_entry_match_predictions" ADD CONSTRAINT "contest_entry_match_predictions_confidence_positive" CHECK ("confidence" IS NULL OR "confidence" >= 1);
