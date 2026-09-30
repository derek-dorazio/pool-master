-- plans/145 slice 4, #205. Drops five tables for features that were never built or are
-- superseded. None is read by a surviving operation:
--   plan_tiers                 SaaS billing tiers; referenced only by the schema.
--   migration_runs             an admin data-migration tool; nothing ever created a row.
--   commissioner_action_items  a commissioner to-do list; nothing ever created a row.
--   ingestion_jobs             a second copy of every ingestion run: each run's job is also
--                              serialized into provider_sync_runs.payload_json.jobPayload by
--                              the sync-run ledger, which is what the sync dashboard reads.
--   provider_health_log        its only writer was the manual health-check operation, deleted
--                              in the same change.
-- One-way: the dropped rows are not recoverable.

-- DropForeignKey
ALTER TABLE "commissioner_action_items" DROP CONSTRAINT "commissioner_action_items_league_id_fkey";

-- DropForeignKey
ALTER TABLE "migration_runs" DROP CONSTRAINT "migration_runs_started_by_fkey";

-- DropTable
DROP TABLE "commissioner_action_items";

-- DropTable
DROP TABLE "ingestion_jobs";

-- DropTable
DROP TABLE "migration_runs";

-- DropTable
DROP TABLE "plan_tiers";

-- DropTable
DROP TABLE "provider_health_log";
