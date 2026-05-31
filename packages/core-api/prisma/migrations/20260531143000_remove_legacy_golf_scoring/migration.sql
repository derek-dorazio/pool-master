DROP TABLE IF EXISTS "contest_entry_pick_golf_roster_contributions";
DROP TABLE IF EXISTS "contest_entry_participant_score_events";
DROP TABLE IF EXISTS "contest_entry_participant_scores";
DROP TABLE IF EXISTS "contest_entry_prize_awards";

DROP INDEX IF EXISTS "contest_entries_contest_id_standings_position_idx";

ALTER TABLE "contest_entries"
  DROP COLUMN IF EXISTS "total_score",
  DROP COLUMN IF EXISTS "standings_position";
