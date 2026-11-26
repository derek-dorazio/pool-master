-- A play-in is a match of its own (#2184): its winner advances into the empty side of the next
-- round's match, so no field row stands for a pairing any more. Each play-in place's side is
-- emptied, and the place goes with what hangs on it (its picks, game picks, tier and price,
-- standing and rounds); its participant, which named the pairing, is inactivated. Only test and
-- QA data has places; the next field and bracket sync loads the play-in as matches.
UPDATE "sport_event_round_match_sides"
SET "sport_event_participant_id" = NULL, "outcome" = 'PENDING', "updated_at" = CURRENT_TIMESTAMP
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "contest_entry_match_predictions"
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "contest_entry_picks"
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "sport_event_participant_valuations"
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "sport_event_participant_standings"
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "sport_event_participant_rounds"
WHERE "sport_event_participant_id" IN (SELECT "id" FROM "sport_event_participants" WHERE "is_play_in_place");

UPDATE "participants"
SET "status" = 'INACTIVE', "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "participant_id" FROM "sport_event_participants" WHERE "is_play_in_place");

DELETE FROM "sport_event_participants" WHERE "is_play_in_place";

ALTER TABLE "sport_event_participants" DROP COLUMN "is_play_in_place";
