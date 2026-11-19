-- Every background job records what started it and how it ended (#1861).
--
-- One trigger enum for jobs and sync runs: the sync-run-only enum (SCHEDULE, WEBHOOK, ADMIN)
-- becomes PrismaJobTrigger, adding COMMISSIONER (a person acting through a league's commissioner
-- tools) and SYSTEM (a job another job queued, or upkeep a member's request asks for). A sync run
-- records its job's trigger.
--
-- background_jobs gains: trigger (jobs from before this read SYSTEM), the person whose request
-- queued an ADMIN or COMMISSIONER job, when its latest try started (for its duration), how many rows it created or
-- changed, and why it did not do its work, as columns Activity sorts and filters on.

CREATE TYPE "PrismaJobTrigger" AS ENUM ('SCHEDULE', 'WEBHOOK', 'ADMIN', 'COMMISSIONER', 'SYSTEM');
CREATE TYPE "PrismaJobErrorType" AS ENUM ('RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'BAD_DATA', 'CHECK_FAILED', 'OTHER');

ALTER TABLE "provider_sync_runs"
  ALTER COLUMN "trigger" TYPE "PrismaJobTrigger" USING "trigger"::text::"PrismaJobTrigger";
DROP TYPE "PrismaProviderSyncTrigger";

-- The default fills the jobs already queued or kept, then goes: every new job names its trigger.
ALTER TABLE "background_jobs"
  ADD COLUMN "trigger" "PrismaJobTrigger" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "started_by_user_id" UUID,
  ADD COLUMN "started_at" TIMESTAMPTZ,
  ADD COLUMN "changed_count" INTEGER,
  ADD COLUMN "error_type" "PrismaJobErrorType";
ALTER TABLE "background_jobs" ALTER COLUMN "trigger" DROP DEFAULT;

ALTER TABLE "background_jobs"
  ADD CONSTRAINT "background_jobs_started_by_user_id_fkey"
  FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Deleting a user sets its jobs' starter to null, so the key needs its own index.
CREATE INDEX "background_jobs_started_by_user_id_idx" ON "background_jobs"("started_by_user_id");
