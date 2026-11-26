-- 10f (#2047): an event's field size is counted over its field rows on read; the stored provider count goes.
ALTER TABLE "sport_events" DROP COLUMN "participant_count";
