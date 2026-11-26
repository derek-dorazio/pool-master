-- A standing's current round is not stored (#2047): the API reads it from the participant's
-- rounds (the highest round it has a score in), so the copy goes.
ALTER TABLE "sport_event_participant_standings" DROP COLUMN "current_round";
