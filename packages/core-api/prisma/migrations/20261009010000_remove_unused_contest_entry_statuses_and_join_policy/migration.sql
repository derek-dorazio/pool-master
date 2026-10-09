-- #531 — remove model values nothing sets or reads.
--
--   * Contest statuses DRAFTING, LOCKED and CANCELLED. The app only ever writes DRAFT, OPEN,
--     ACTIVE and COMPLETED.
--   * Entry status INACTIVE. Nothing writes it.
--   * contest_entries.is_eliminated. Nothing reads or writes it.
--   * leagues.join_policy and its enum. No join path reads it; every join is an invitation.
--
-- The app cannot have written the removed statuses, so no real row holds them. A row that a test
-- or a hand edit left behind is moved to the nearest status that behaves the same way, so the
-- migration never fails on it: DRAFTING and LOCKED were startable before play like OPEN, so they
-- become OPEN; CANCELLED was terminal like COMPLETED; INACTIVE counted nowhere like DRAFT.
--
-- Each type is rebuilt rather than altered: Postgres cannot drop a value from an enum.

-- Contest status.
ALTER TABLE "contests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "PrismaContestStatus" RENAME TO "PrismaContestStatus_old";
CREATE TYPE "PrismaContestStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED');
ALTER TABLE "contests"
  ALTER COLUMN "status" TYPE "PrismaContestStatus"
  USING (
    CASE "status"::text
      WHEN 'DRAFTING' THEN 'OPEN'
      WHEN 'LOCKED' THEN 'OPEN'
      WHEN 'CANCELLED' THEN 'COMPLETED'
      ELSE "status"::text
    END
  )::"PrismaContestStatus";
DROP TYPE "PrismaContestStatus_old";
ALTER TABLE "contests" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Contest entry status.
ALTER TABLE "contest_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "PrismaContestEntryStatus" RENAME TO "PrismaContestEntryStatus_old";
CREATE TYPE "PrismaContestEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED');
ALTER TABLE "contest_entries"
  ALTER COLUMN "status" TYPE "PrismaContestEntryStatus"
  USING (CASE "status"::text WHEN 'INACTIVE' THEN 'DRAFT' ELSE "status"::text END)::"PrismaContestEntryStatus";
DROP TYPE "PrismaContestEntryStatus_old";
ALTER TABLE "contest_entries" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Unread columns.
ALTER TABLE "contest_entries" DROP COLUMN "is_eliminated";
ALTER TABLE "leagues" DROP COLUMN "join_policy";
DROP TYPE "PrismaLeagueJoinPolicy";
