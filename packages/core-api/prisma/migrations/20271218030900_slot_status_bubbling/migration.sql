-- Slice 14 (#2013): status bubbles Game -> Match -> Season slot -> event on two refresh jobs, and a
-- stroke-play slot records the feed's FINAL, which completes it.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'REFRESH_SLOT_STATUS';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'REFRESH_EVENT_STATUS';

ALTER TABLE "sport_event_slots" ADD COLUMN "feed_final_at" TIMESTAMPTZ;
