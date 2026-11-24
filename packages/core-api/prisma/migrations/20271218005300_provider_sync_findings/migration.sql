-- League model 2 (#1999): sync findings. One row per kind and subject; the sync raising it again
-- updates the row. A finding always names its sport league; the event, Provider and the
-- provider's own value are optional parts of the subject. The table starts empty: the sync
-- raises its findings on its next pass.

-- CreateEnum
CREATE TYPE "PrismaProviderSyncFindingSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "PrismaProviderSyncFindingStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PrismaProviderSyncFindingKind" AS ENUM ('UNMAPPED_PARTICIPANT', 'WEBHOOK_SECRET_MISSING');

-- CreateTable
CREATE TABLE "provider_sync_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "PrismaProviderSyncFindingKind" NOT NULL,
    "severity" "PrismaProviderSyncFindingSeverity" NOT NULL,
    "status" "PrismaProviderSyncFindingStatus" NOT NULL DEFAULT 'OPEN',
    "sport_league_id" UUID NOT NULL,
    "sport_event_id" UUID,
    "provider_id" UUID,
    "provider_value" VARCHAR(255),
    "provider_value_name" VARCHAR(255),
    "waive_note" TEXT,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "status_changed_at" TIMESTAMPTZ NOT NULL,
    "status_changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_sync_findings_pkey" PRIMARY KEY ("id")
);

-- One row per kind and subject, a missing part of the subject counting as a value
-- (PostgreSQL 15+; QA and production run 16).
CREATE UNIQUE INDEX "provider_sync_findings_subject_key" ON "provider_sync_findings"("kind", "sport_league_id", "sport_event_id", "provider_id", "provider_value") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "provider_sync_findings_sport_league_id_status_severity_idx" ON "provider_sync_findings"("sport_league_id", "status", "severity");

-- CreateIndex
CREATE INDEX "provider_sync_findings_sport_event_id_idx" ON "provider_sync_findings"("sport_event_id");

-- CreateIndex
CREATE INDEX "provider_sync_findings_provider_id_idx" ON "provider_sync_findings"("provider_id");

-- CreateIndex
CREATE INDEX "provider_sync_findings_status_changed_by_user_id_idx" ON "provider_sync_findings"("status_changed_by_user_id");

-- CreateIndex
CREATE INDEX "provider_sync_findings_status_status_changed_at_idx" ON "provider_sync_findings"("status", "status_changed_at");

-- A waived finding says why; a blank note is no note.
ALTER TABLE "provider_sync_findings"
  ADD CONSTRAINT "provider_sync_findings_waive_note_required" CHECK ("status" <> 'WAIVED' OR length(btrim("waive_note")) > 0),
  ADD CONSTRAINT "provider_sync_findings_seen_count_positive" CHECK ("seen_count" >= 1);

-- AddForeignKey
ALTER TABLE "provider_sync_findings" ADD CONSTRAINT "provider_sync_findings_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sync_findings" ADD CONSTRAINT "provider_sync_findings_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sync_findings" ADD CONSTRAINT "provider_sync_findings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sync_findings" ADD CONSTRAINT "provider_sync_findings_status_changed_by_user_id_fkey" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
