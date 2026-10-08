-- #481: an entry is a DRAFT until its owner submits a valid lineup, and only SUBMITTED entries
-- count on the leaderboard, in standings and at settlement.
--
-- Every existing ACTIVE entry becomes SUBMITTED, so entries made before this change keep
-- counting exactly as they did. New entries start as DRAFT.
--
-- The type is rebuilt rather than altered in place: a value added with ALTER TYPE ... ADD VALUE
-- cannot be used (here, as the column default) in the same transaction that added it.

CREATE TYPE "PrismaContestEntryStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'INACTIVE');

ALTER TABLE "contest_entries"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaContestEntryStatus_new"
    USING (CASE "status"::text WHEN 'ACTIVE' THEN 'SUBMITTED' ELSE "status"::text END)::"PrismaContestEntryStatus_new",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "PrismaContestEntryStatus";
ALTER TYPE "PrismaContestEntryStatus_new" RENAME TO "PrismaContestEntryStatus";
