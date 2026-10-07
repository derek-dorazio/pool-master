-- #430: a contest's lock time was stored and shown but never enforced. Entries open when the
-- commissioner opens the contest and close when its event starts, so both copies go.
ALTER TABLE "contests" DROP COLUMN "lock_at";
ALTER TABLE "contest_configurations" DROP COLUMN "locks_at";
