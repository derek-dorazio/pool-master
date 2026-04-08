ALTER TABLE "contest_entries"
  DROP CONSTRAINT IF EXISTS "contest_entries_contest_id_league_membership_id_key";

ALTER TABLE "contest_entries"
  DROP CONSTRAINT IF EXISTS "contest_entries_league_membership_id_fkey";

ALTER TABLE "contest_entries"
  DROP COLUMN IF EXISTS "league_membership_id",
  DROP COLUMN IF EXISTS "rank",
  ADD COLUMN "squad_id" UUID NOT NULL,
  ADD COLUMN "entry_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "standings_position" INTEGER;

CREATE UNIQUE INDEX "contest_entries_contest_id_squad_id_entry_number_key"
  ON "contest_entries"("contest_id", "squad_id", "entry_number");

CREATE INDEX "contest_entries_contest_id_standings_position_idx"
  ON "contest_entries"("contest_id", "standings_position");

ALTER TABLE "contest_entries"
  ADD CONSTRAINT "contest_entries_squad_id_fkey"
  FOREIGN KEY ("squad_id") REFERENCES "squads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
