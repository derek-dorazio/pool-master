-- Slice 2 (core), #235: the Event and Participant core loses its golf leaks, and
-- standing / round split into a cross-sport base plus a golf extension.
--
-- Every change below is a rename or a copy-then-reshape; no row is deleted. The file
-- runs as one implicit transaction, so the type changes and the data they carry land
-- together or not at all.

-- ============================================================================
-- 1. ParticipantInactiveReason: WITHDRAWN / ELIMINATED. CUT folds into ELIMINATED
--    in the same statement that changes the column type, so there is no moment at
--    which the column exists with the new type and an unconverted CUT row.
-- ============================================================================
CREATE TYPE "ParticipantInactiveReason" AS ENUM ('WITHDRAWN', 'ELIMINATED');

ALTER TABLE "sport_event_participants"
  ALTER COLUMN "inactive_reason" TYPE "ParticipantInactiveReason"
  USING (
    CASE "inactive_reason"::text
      WHEN 'CUT' THEN 'ELIMINATED'
      ELSE "inactive_reason"::text
    END
  )::"ParticipantInactiveReason";

DROP TYPE "PrismaGolfParticipantInactiveReason";

-- ============================================================================
-- 2. worldRanking -> ranking, on both tables. Pure renames: values untouched.
-- ============================================================================
ALTER TABLE "participant_league_affiliations" RENAME COLUMN "world_ranking" TO "ranking";
ALTER INDEX "participant_league_affiliations_sport_league_id_world_ran_idx"
  RENAME TO "participant_league_affiliations_sport_league_id_ranking_idx";

ALTER TABLE "sport_event_participants" RENAME COLUMN "world_ranking" TO "ranking";

-- ============================================================================
-- 3. ValuationSource. AUTO_WORLD_RANK names the column renamed in step 2, so it
--    follows it to AUTO_RANKING. RENAME VALUE rewrites the label in place.
-- ============================================================================
ALTER TYPE "PrismaGolfValuationSource" RENAME TO "ValuationSource";
ALTER TYPE "ValuationSource" RENAME VALUE 'AUTO_WORLD_RANK' TO 'AUTO_RANKING';

-- ============================================================================
-- 4. SportEventGolfTier -> SportEventTier. No golf columns; renamed in place. The
--    id default is dropped to match every Prisma-created table (Prisma always
--    supplies the id); the same applies to the valuation and golf-standing ids.
-- ============================================================================
ALTER TABLE "sport_event_golf_tiers" RENAME TO "sport_event_tiers";
ALTER TABLE "sport_event_tiers" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "sport_event_tiers" RENAME CONSTRAINT "sport_event_golf_tiers_pkey" TO "sport_event_tiers_pkey";
ALTER TABLE "sport_event_tiers" RENAME CONSTRAINT "sport_event_golf_tiers_sport_event_id_fkey" TO "sport_event_tiers_sport_event_id_fkey";
ALTER INDEX "sport_event_golf_tiers_sport_event_id_tier_key_key" RENAME TO "sport_event_tiers_sport_event_id_tier_key_key";
ALTER INDEX "sport_event_golf_tiers_sport_event_id_tier_number_key" RENAME TO "sport_event_tiers_sport_event_id_tier_number_key";

-- ============================================================================
-- 5. SportEventParticipantGolfValuation -> SportEventParticipantValuation. No golf
--    columns; renamed in place, and its tier FK column follows the tier table.
--    The id default is dropped to match every Prisma-created table (Prisma always
--    supplies the id).
-- ============================================================================
ALTER TABLE "sport_event_participant_golf_valuations" RENAME TO "sport_event_participant_valuations";
ALTER TABLE "sport_event_participant_valuations" RENAME COLUMN "sport_event_golf_tier_id" TO "sport_event_tier_id";
ALTER TABLE "sport_event_participant_valuations" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "sport_event_participant_valuations" RENAME CONSTRAINT "sport_event_participant_golf_valuations_pkey" TO "sport_event_participant_valuations_pkey";
ALTER TABLE "sport_event_participant_valuations" RENAME CONSTRAINT "sep_golf_valuations_sep_id_fkey" TO "sport_event_participant_valuations_sport_event_participant_fkey";
ALTER TABLE "sport_event_participant_valuations" RENAME CONSTRAINT "sep_golf_valuations_tier_id_fkey" TO "sport_event_participant_valuations_sport_event_tier_id_fkey";
ALTER INDEX "sep_golf_valuations_sep_id_key" RENAME TO "sport_event_participant_valuations_sport_event_participant__key";
ALTER INDEX "sep_golf_valuations_tier_id_order_idx" RENAME TO "sport_event_participant_valuations_sport_event_tier_id_tier_idx";

-- ============================================================================
-- 6. Round: base SportEventParticipantRound + golf extension.
--    Each golf round row becomes one base row with the SAME id, then the golf row
--    points at it and loses the columns that moved. status and completedAt are a
--    participant's round progress, not golf scoring, so they move to the base.
-- ============================================================================
CREATE TABLE "sport_event_participant_rounds" (
    "id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "sport_event_round_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_rounds_pkey" PRIMARY KEY ("id")
);

INSERT INTO "sport_event_participant_rounds"
  ("id", "sport_event_participant_id", "sport_event_round_id", "status", "completed_at", "created_at", "updated_at")
SELECT "id", "sport_event_participant_id", "sport_event_round_id", "status", "completed_at", "created_at", "updated_at"
FROM "sport_event_participant_golf_rounds";

CREATE UNIQUE INDEX "sport_event_participant_rounds_sport_event_participant_id_s_key"
  ON "sport_event_participant_rounds"("sport_event_participant_id", "sport_event_round_id");
CREATE INDEX "sport_event_participant_rounds_sport_event_participant_id_idx"
  ON "sport_event_participant_rounds"("sport_event_participant_id");
ALTER TABLE "sport_event_participant_rounds"
  ADD CONSTRAINT "sport_event_participant_rounds_sport_event_participant_id_fkey"
  FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sport_event_participant_rounds"
  ADD CONSTRAINT "sport_event_participant_rounds_sport_event_round_id_fkey"
  FOREIGN KEY ("sport_event_round_id") REFERENCES "sport_event_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sport_event_participant_golf_rounds" ADD COLUMN "participant_round_id" UUID;
UPDATE "sport_event_participant_golf_rounds" SET "participant_round_id" = "id";
ALTER TABLE "sport_event_participant_golf_rounds" ALTER COLUMN "participant_round_id" SET NOT NULL;

ALTER TABLE "sport_event_participant_golf_rounds" DROP CONSTRAINT "sep_golf_rounds_round_id_fkey";
ALTER TABLE "sport_event_participant_golf_rounds" DROP CONSTRAINT "sport_event_participant_golf_rounds_sport_event_participan_fkey";
DROP INDEX "sep_golf_rounds_sep_id_round_id_key";
DROP INDEX "sport_event_participant_golf_rounds_sport_event_participant_idx";
ALTER TABLE "sport_event_participant_golf_rounds"
  DROP COLUMN "sport_event_participant_id",
  DROP COLUMN "sport_event_round_id",
  DROP COLUMN "status",
  DROP COLUMN "completed_at";

CREATE UNIQUE INDEX "sport_event_participant_golf_rounds_participant_round_id_key"
  ON "sport_event_participant_golf_rounds"("participant_round_id");
ALTER TABLE "sport_event_participant_golf_rounds"
  ADD CONSTRAINT "sport_event_participant_golf_rounds_participant_round_id_fkey"
  FOREIGN KEY ("participant_round_id") REFERENCES "sport_event_participant_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 7. Standing: base SportEventParticipantStanding + golf extension.
--    Same shape as step 6: same ids, then the golf row points at its base row.
--    The golf live-status enum becomes the cross-sport ParticipantStandingStatus;
--    'missed-cut' is ELIMINATED, as CUT is in step 1.
-- ============================================================================
CREATE TYPE "ParticipantStandingStatus" AS ENUM ('ACTIVE', 'IN_PROGRESS', 'COMPLETE', 'WITHDRAWN', 'ELIMINATED');

CREATE TABLE "sport_event_participant_standings" (
    "id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "status" "ParticipantStandingStatus" NOT NULL DEFAULT 'ACTIVE',
    "as_of" TIMESTAMPTZ,
    "current_round" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_standings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "sport_event_participant_standings"
  ("id", "sport_event_participant_id", "position", "display_position", "status", "as_of", "current_round", "created_at", "updated_at")
SELECT
  "id",
  "sport_event_participant_id",
  "position",
  "display_position",
  (
    CASE "status"::text
      WHEN 'active' THEN 'ACTIVE'
      WHEN 'in-progress' THEN 'IN_PROGRESS'
      WHEN 'complete' THEN 'COMPLETE'
      WHEN 'withdrawn' THEN 'WITHDRAWN'
      WHEN 'missed-cut' THEN 'ELIMINATED'
    END
  )::"ParticipantStandingStatus",
  "as_of",
  "current_round",
  "created_at",
  "updated_at"
FROM "sport_event_participant_golf_standings";

CREATE UNIQUE INDEX "sport_event_participant_standings_sport_event_participant_i_key"
  ON "sport_event_participant_standings"("sport_event_participant_id");
CREATE INDEX "sport_event_participant_standings_status_idx" ON "sport_event_participant_standings"("status");
CREATE INDEX "sport_event_participant_standings_position_idx" ON "sport_event_participant_standings"("position");
ALTER TABLE "sport_event_participant_standings"
  ADD CONSTRAINT "sport_event_participant_standings_sport_event_participant__fkey"
  FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sport_event_participant_golf_standings" ADD COLUMN "standing_id" UUID;
UPDATE "sport_event_participant_golf_standings" SET "standing_id" = "id";
ALTER TABLE "sport_event_participant_golf_standings" ALTER COLUMN "standing_id" SET NOT NULL;
ALTER TABLE "sport_event_participant_golf_standings" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "sport_event_participant_golf_standings" DROP CONSTRAINT "sep_golf_standings_sep_id_fkey";
DROP INDEX "sep_golf_standings_sep_id_key";
DROP INDEX "sep_golf_standings_status_idx";
DROP INDEX "sep_golf_standings_position_idx";
ALTER TABLE "sport_event_participant_golf_standings"
  DROP COLUMN "sport_event_participant_id",
  DROP COLUMN "position",
  DROP COLUMN "display_position",
  DROP COLUMN "status",
  DROP COLUMN "as_of",
  DROP COLUMN "current_round";

CREATE UNIQUE INDEX "sport_event_participant_golf_standings_standing_id_key"
  ON "sport_event_participant_golf_standings"("standing_id");
ALTER TABLE "sport_event_participant_golf_standings"
  ADD CONSTRAINT "sport_event_participant_golf_standings_standing_id_fkey"
  FOREIGN KEY ("standing_id") REFERENCES "sport_event_participant_standings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "PrismaGolfLiveStatus";
