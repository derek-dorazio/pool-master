-- Who set a match's result (#1531): an admin, or the provider of its linked game. A provider's
-- later final never overwrites an admin's result.
CREATE TYPE "PrismaMatchResultSource" AS ENUM ('ADMIN', 'PROVIDER');

ALTER TABLE "sport_event_matches" ADD COLUMN "result_source" "PrismaMatchResultSource";

-- Every existing result is marked the admin's. A provider final written since #1496 part 1 (or
-- part 2c's automatic linking) cannot be told apart from an admin's here; marking it ADMIN only
-- means a later, different provider final is logged rather than written, and clearing the
-- result hands the match back to the feed.
UPDATE "sport_event_matches" SET "result_source" = 'ADMIN' WHERE "status" IN ('COMPLETED', 'CANCELLED');
