ALTER TABLE "squads"
  ADD COLUMN "is_active" BOOLEAN;

UPDATE "squads"
SET "is_active" = CASE
  WHEN "status" = 'ACTIVE' THEN TRUE
  ELSE FALSE
END;

ALTER TABLE "squads"
  ALTER COLUMN "is_active" SET DEFAULT TRUE,
  ALTER COLUMN "is_active" SET NOT NULL;

DROP INDEX IF EXISTS "squads_league_id_status_idx";

CREATE INDEX "squads_league_id_is_active_idx"
  ON "squads"("league_id", "is_active");

ALTER TABLE "squads"
  DROP COLUMN "status";

DROP TYPE IF EXISTS "PrismaSquadStatus";
