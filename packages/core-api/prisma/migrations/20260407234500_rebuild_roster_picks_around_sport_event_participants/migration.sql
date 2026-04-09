DELETE FROM "roster_picks";

ALTER TABLE "roster_picks"
  DROP CONSTRAINT IF EXISTS "roster_picks_participant_id_fkey";

ALTER TABLE "roster_picks"
  DROP COLUMN IF EXISTS "participant_id",
  ADD COLUMN "sport_event_participant_id" UUID NOT NULL;

ALTER TABLE "roster_picks"
  ADD CONSTRAINT "roster_picks_sport_event_participant_id_fkey"
  FOREIGN KEY ("sport_event_participant_id")
  REFERENCES "sport_event_participants"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "roster_picks_entry_id_sport_event_participant_id_key"
  ON "roster_picks"("entry_id", "sport_event_participant_id");
