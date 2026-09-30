-- plans/145 slice 4, #205. listProviderSyncRuns now filters by a created_at window instead of
-- taking a row limit. Its unfiltered call — the sync dashboard's — has no leading column for
-- the (provider_id | sport | status, created_at DESC) indexes to use, so it gets its own.

-- CreateIndex
CREATE INDEX "provider_sync_runs_created_at_idx" ON "provider_sync_runs"("created_at" DESC);
