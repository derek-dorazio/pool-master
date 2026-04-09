-- Add event-scoped participant identity, provider payload storage, and valuation tables.

CREATE TABLE IF NOT EXISTS "sport_event_participants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_id" UUID NOT NULL,
  "participant_id" UUID NOT NULL,
  "status" VARCHAR(50),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sport_event_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sport_event_participants_sport_event_id_participant_id_key"
    UNIQUE ("sport_event_id", "participant_id"),
  CONSTRAINT "sport_event_participants_sport_event_id_fkey"
    FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sport_event_participants_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "participants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sport_event_participants_sport_event_id_idx"
  ON "sport_event_participants"("sport_event_id");
CREATE INDEX IF NOT EXISTS "sport_event_participants_participant_id_idx"
  ON "sport_event_participants"("participant_id");

CREATE TABLE IF NOT EXISTS "sport_event_participant_source_data" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_participant_id" UUID NOT NULL,
  "provider_id" VARCHAR(100) NOT NULL,
  "external_id" VARCHAR(255) NOT NULL,
  "raw_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "normalized_data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "received_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sport_event_participant_source_data_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sport_event_participant_source_data_sport_event_participant_id_fkey"
    FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sport_event_participant_source_data_participant_received_at_idx"
  ON "sport_event_participant_source_data"("sport_event_participant_id", "received_at" DESC);
CREATE INDEX IF NOT EXISTS "sport_event_participant_source_data_provider_external_idx"
  ON "sport_event_participant_source_data"("provider_id", "external_id");

CREATE TABLE IF NOT EXISTS "sport_event_participant_valuations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_participant_id" UUID NOT NULL,
  "price" DOUBLE PRECISION,
  "tier" VARCHAR(50),
  "order_index" INTEGER,
  "valuation_source" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sport_event_participant_valuations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sport_event_participant_valuations_unique_source"
    UNIQUE ("sport_event_participant_id", "valuation_source"),
  CONSTRAINT "sport_event_participant_valuations_sport_event_participant_id_fkey"
    FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sport_event_participant_valuations_sport_event_participant_id_idx"
  ON "sport_event_participant_valuations"("sport_event_participant_id");
