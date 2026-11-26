-- A tier is told apart by its number alone (#2047): its words are computed from the number
-- by the shared tierLabel display string, so the stored name goes.
ALTER TABLE "sport_event_tiers" DROP COLUMN "label";
