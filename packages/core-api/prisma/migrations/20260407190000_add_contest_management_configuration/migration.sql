-- Add contest-management configuration tables and contest -> sport event linkage.

ALTER TABLE "contests"
ADD COLUMN IF NOT EXISTS "sport_event_id" UUID;

CREATE INDEX IF NOT EXISTS "contests_sport_event_id_idx" ON "contests"("sport_event_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'contests_sport_event_id_fkey'
      AND table_name = 'contests'
  ) THEN
    ALTER TABLE "contests"
    ADD CONSTRAINT "contests_sport_event_id_fkey"
    FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "contest_configurations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contest_id" UUID NOT NULL,
  "selection_type" VARCHAR(50) NOT NULL,
  "locks_at" TIMESTAMPTZ,
  "minimum_entries" INTEGER,
  "max_entries_per_squad" INTEGER,
  "roster_size" INTEGER,
  "total_prize_pool_amount" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contest_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contest_configurations_contest_id_key" UNIQUE ("contest_id"),
  CONSTRAINT "contest_configurations_contest_id_fkey"
    FOREIGN KEY ("contest_id") REFERENCES "contests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "participant_contest_scoring_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contest_configuration_id" UUID NOT NULL,
  "participant_scoring_definition_id" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "participant_contest_scoring_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "participant_contest_scoring_rules_unique_sort_order"
    UNIQUE ("contest_configuration_id", "sort_order"),
  CONSTRAINT "participant_contest_scoring_rules_contest_configuration_id_fkey"
    FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "participant_contest_scoring_rules_contest_configuration_id_idx"
  ON "participant_contest_scoring_rules"("contest_configuration_id");

CREATE TABLE IF NOT EXISTS "contest_entry_aggregation_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contest_configuration_id" UUID NOT NULL,
  "aggregation_definition_id" VARCHAR(100) NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contest_entry_aggregation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contest_entry_aggregation_rules_contest_configuration_id_key"
    UNIQUE ("contest_configuration_id"),
  CONSTRAINT "contest_entry_aggregation_rules_contest_configuration_id_fkey"
    FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "contest_prize_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contest_configuration_id" UUID NOT NULL,
  "prize_definition_id" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "rule_config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "payout_type" VARCHAR(50),
  "amount" DOUBLE PRECISION,
  "percentage" DOUBLE PRECISION,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contest_prize_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contest_prize_definitions_unique_sort_order"
    UNIQUE ("contest_configuration_id", "sort_order"),
  CONSTRAINT "contest_prize_definitions_contest_configuration_id_fkey"
    FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "contest_prize_definitions_contest_configuration_id_idx"
  ON "contest_prize_definitions"("contest_configuration_id");
