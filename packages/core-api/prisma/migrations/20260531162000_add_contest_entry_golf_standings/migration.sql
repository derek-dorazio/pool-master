CREATE TABLE "contest_entry_golf_standings" (
  "id" UUID NOT NULL,
  "contest_id" UUID NOT NULL,
  "contest_entry_id" UUID NOT NULL,
  "total_score_to_par" INTEGER,
  "position" INTEGER,
  "display_position" VARCHAR(20),
  "counting_pick_count" INTEGER NOT NULL,
  "scored_pick_count" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'FINAL',
  "as_of" TIMESTAMPTZ,
  "settled_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "contest_entry_golf_standings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contest_entry_golf_standings_contest_entry_id_key"
  ON "contest_entry_golf_standings"("contest_entry_id");
CREATE INDEX "contest_entry_golf_standings_contest_id_position_idx"
  ON "contest_entry_golf_standings"("contest_id", "position");
CREATE INDEX "contest_entry_golf_standings_status_idx"
  ON "contest_entry_golf_standings"("status");

ALTER TABLE "contest_entry_golf_standings"
  ADD CONSTRAINT "contest_entry_golf_standings_contest_id_fkey"
  FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contest_entry_golf_standings"
  ADD CONSTRAINT "contest_entry_golf_standings_contest_entry_id_fkey"
  FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
