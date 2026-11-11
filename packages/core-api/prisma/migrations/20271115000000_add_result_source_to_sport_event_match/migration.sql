-- Who set a match's result (#1531): an admin, or the provider of its linked game. A provider's
-- later final never overwrites an admin's result.
CREATE TYPE "PrismaMatchResultSource" AS ENUM ('ADMIN', 'PROVIDER');

ALTER TABLE "sport_event_matches" ADD COLUMN "result_source" "PrismaMatchResultSource";

-- Every result written before this was an admin's: no match was linked to a provider game yet.
UPDATE "sport_event_matches" SET "result_source" = 'ADMIN' WHERE "status" IN ('COMPLETED', 'CANCELLED');
