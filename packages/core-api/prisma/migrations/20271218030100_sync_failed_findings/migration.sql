-- A sync run that ends FAILED raises a SYNC_FAILED finding (#2092): one per league, event,
-- Provider and sync kind, naming the latest run that failed. The next COMPLETED run of the same
-- subject resolves it.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SYNC_FAILED';

ALTER TABLE "provider_sync_findings"
  ADD COLUMN "sync_kind" "PrismaProviderSyncKind",
  ADD COLUMN "sync_run_id" UUID;

ALTER TABLE "provider_sync_findings"
  ADD CONSTRAINT "provider_sync_findings_sync_run_id_fkey"
  FOREIGN KEY ("sync_run_id") REFERENCES "provider_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "provider_sync_findings_sync_run_id_idx" ON "provider_sync_findings"("sync_run_id");

-- The sync kind joins the subject: a field sync and a scores sync of one event fail apart.
DROP INDEX "provider_sync_findings_subject_key";
CREATE UNIQUE INDEX "provider_sync_findings_subject_key" ON "provider_sync_findings"("kind", "sport_league_id", "sport_event_id", "provider_id", "provider_value", "sync_kind") NULLS NOT DISTINCT;

-- A SYNC_FAILED finding always names its sync kind, and no other kind has one. The kind is
-- compared as text: the new enum value cannot be used in the transaction that adds it.
ALTER TABLE "provider_sync_findings"
  ADD CONSTRAINT "provider_sync_findings_sync_kind_check"
  CHECK (("kind"::text = 'SYNC_FAILED') = ("sync_kind" IS NOT NULL));
