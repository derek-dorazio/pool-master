-- #1440: the background job table. Durable work a request hands off, claimed by any server task.

CREATE TYPE "PrismaBackgroundJobType" AS ENUM ('MANUAL_EVENT_SYNC');

CREATE TYPE "PrismaBackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "PrismaBackgroundJobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PrismaBackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ,
    "last_error" TEXT,
    "dedupe_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "background_jobs_dedupe_key_key" ON "background_jobs"("dedupe_key");

CREATE INDEX "background_jobs_status_run_at_idx" ON "background_jobs"("status", "run_at");

CREATE INDEX "background_jobs_status_lease_until_idx" ON "background_jobs"("status", "lease_until");

CREATE INDEX "background_jobs_status_completed_at_idx" ON "background_jobs"("status", "completed_at");

-- A running job always has a lease, and a finished one always has its completion time.
ALTER TABLE "background_jobs" ADD CONSTRAINT background_jobs_leased_when_running CHECK (((status <> 'RUNNING'::"PrismaBackgroundJobStatus") OR (lease_until IS NOT NULL)));
ALTER TABLE "background_jobs" ADD CONSTRAINT background_jobs_completed_when_finished CHECK (((status <> ALL (ARRAY['SUCCEEDED'::"PrismaBackgroundJobStatus", 'FAILED'::"PrismaBackgroundJobStatus"])) OR (completed_at IS NOT NULL)));
