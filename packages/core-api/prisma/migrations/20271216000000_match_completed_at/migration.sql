-- #1889: the root admin's Event page shows when each match's result was recorded, and when each
-- round's results were all in. A match records the time it went COMPLETED; any other status has
-- none. Matches already completed take their last update, the nearest time kept for them.
ALTER TABLE "sport_event_matches" ADD COLUMN "completed_at" TIMESTAMPTZ;

UPDATE "sport_event_matches" SET "completed_at" = "updated_at" WHERE "status" = 'COMPLETED';

