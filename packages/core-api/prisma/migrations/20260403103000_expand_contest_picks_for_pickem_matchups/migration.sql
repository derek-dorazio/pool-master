ALTER TABLE "contest_picks"
  ADD COLUMN "event_id" UUID,
  ADD COLUMN "matchup_index" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "contest_picks_entry_id_contest_id_period_key";

CREATE UNIQUE INDEX "contest_picks_entry_id_contest_id_period_matchup_index_key"
  ON "contest_picks"("entry_id", "contest_id", "period", "matchup_index");

CREATE INDEX "contest_picks_event_id_idx" ON "contest_picks"("event_id");
