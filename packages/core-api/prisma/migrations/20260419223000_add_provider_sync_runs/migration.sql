CREATE TABLE "provider_sync_runs" (
  "id" UUID NOT NULL,
  "provider_id" VARCHAR(100) NOT NULL,
  "sport" VARCHAR(50) NOT NULL,
  "event_id" VARCHAR(255),
  "status" VARCHAR(50) NOT NULL,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "payload_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_sync_runs_provider_id_created_at_idx"
  ON "provider_sync_runs"("provider_id", "created_at" DESC);

CREATE INDEX "provider_sync_runs_sport_created_at_idx"
  ON "provider_sync_runs"("sport", "created_at" DESC);

CREATE INDEX "provider_sync_runs_status_created_at_idx"
  ON "provider_sync_runs"("status", "created_at" DESC);
