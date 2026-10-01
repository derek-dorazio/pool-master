-- #260, #262, #263 — three tables nothing in the product writes or reads.
--
-- notifications (#260): a notification feature designed and never built. Its only access was
--   a deleteMany in user deletion; no notification event was ever emitted or consumed.
-- consent_records (#262): never written. The owner weighed the compliance question (a consent
--   record can matter for a reason no code expresses) and ruled to delete it; the system holds
--   no consent records, with or without this table.
-- contest_timing_policies (#263): read on every ingestion run, never written, so every read
--   returned nothing. The release/field-lock rule language it carried is recorded in
--   plans/145 ("Dead-code sweep — outcome") so the design is not lost with the table.
--
-- league_events (#262) is deliberately NOT dropped. #262 called it dead, and a consumer check
-- showed otherwise: SportEventService writes it on every event creation (createEvent and
-- createEventFromProviderEvent both find-or-create it and stamp sport_events.league_event_id);
-- the id is published as SportEventDto.leagueEventId, "the recurring tournament this is one
-- year's instance of"; a unit test asserts two years of one tournament share it; and plans/127
-- designs PREVIOUS_WINNER history on it so winners need no copying forward between years.
-- Dropping it would have broken event creation. Kept on that evidence.
--
-- Destructive and one-way. There is no production database (plans/129): this drops rows in QA
-- and local databases only, and recovery is a rebuild from the schema, not a restore.

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropTable
DROP TABLE "notifications";

-- DropTable
DROP TABLE "consent_records";

-- DropTable
DROP TABLE "contest_timing_policies";
