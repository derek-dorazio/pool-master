-- Slice 7d (#2074): the feed is the only writer of a synced event's results, so an admin's
-- result no longer stands against it. A result an admin wrote before is the feed's to overwrite:
-- it is marked as the provider's, and the ADMIN value goes. The column moves onto the Game in
-- #2046, which drops it with PROVIDER its only value.
UPDATE "sport_event_round_matches" SET "result_source" = 'PROVIDER' WHERE "result_source" = 'ADMIN';

ALTER TYPE "PrismaMatchResultSource" RENAME TO "PrismaMatchResultSource_old";
CREATE TYPE "PrismaMatchResultSource" AS ENUM ('PROVIDER');
ALTER TABLE "sport_event_round_matches"
  ALTER COLUMN "result_source" TYPE "PrismaMatchResultSource" USING ("result_source"::text::"PrismaMatchResultSource");
DROP TYPE "PrismaMatchResultSource_old";
