-- The League page (#1865): when an event was released, and when a sync last saw a participant
-- in its provider's feed. Existing rows stay null: neither was recorded before.
ALTER TABLE "sport_events" ADD COLUMN "released_at" TIMESTAMPTZ;
ALTER TABLE "participant_provider_mappings" ADD COLUMN "last_seen_at" TIMESTAMPTZ;

-- The events read takes each event's latest run of each kind.
CREATE INDEX "provider_sync_runs_sport_event_id_kind_created_at_idx" ON "provider_sync_runs"("sport_event_id", "kind", "created_at" DESC);
