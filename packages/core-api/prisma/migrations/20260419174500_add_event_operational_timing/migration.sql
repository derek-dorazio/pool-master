ALTER TABLE "sport_events"
ADD COLUMN "release_at" TIMESTAMPTZ,
ADD COLUMN "field_locks_at" TIMESTAMPTZ;

UPDATE "sport_events"
SET
  "release_at" = "start_date",
  "field_locks_at" = "start_date"
WHERE "release_at" IS NULL
   OR "field_locks_at" IS NULL;

ALTER TABLE "sport_events"
ALTER COLUMN "release_at" SET NOT NULL,
ALTER COLUMN "field_locks_at" SET NOT NULL;

CREATE TABLE "contest_timing_policies" (
  "id" UUID NOT NULL,
  "sport" VARCHAR(50) NOT NULL,
  "event_type" VARCHAR(100),
  "contest_type" VARCHAR(100),
  "release_rule" VARCHAR(255) NOT NULL,
  "field_lock_rule" VARCHAR(255) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contest_timing_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contest_timing_policies_sport_event_type_contest_type_key"
  ON "contest_timing_policies" ("sport", "event_type", "contest_type");

CREATE INDEX "contest_timing_policies_sport_active_idx"
  ON "contest_timing_policies" ("sport", "active");
