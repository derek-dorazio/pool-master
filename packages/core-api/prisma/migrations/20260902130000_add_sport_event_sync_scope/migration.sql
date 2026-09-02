-- plans/124-golf-admin-tournament-management.md §3.5/§4.4.
--
-- syncScope is separate from providerId/externalId identity: it governs
-- which scheduled sync feeds may touch a SportEvent. @default(FULL) means
-- every existing/ingestion-created row keeps behaving exactly as it does
-- today; only admin-authored tournaments (a later slice) start at NONE.

-- CreateEnum
CREATE TYPE "PrismaSportEventSyncScope" AS ENUM ('NONE', 'SCORES_ONLY', 'FULL');

-- AlterTable
ALTER TABLE "sport_events" ADD COLUMN "sync_scope" "PrismaSportEventSyncScope" NOT NULL DEFAULT 'FULL';
