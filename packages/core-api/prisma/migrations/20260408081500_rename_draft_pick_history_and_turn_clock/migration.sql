ALTER TABLE "draft_sessions"
  RENAME COLUMN "pick_deadline" TO "current_turn_started_at";

ALTER TABLE "draft_picks"
  RENAME TO "draft_pick_histories";

ALTER TABLE "draft_pick_histories"
  ADD COLUMN "roster_pick_id" UUID;

UPDATE "draft_pick_histories" dph
SET "roster_pick_id" = rp.id
FROM "roster_picks" rp
JOIN "sport_event_participants" sep
  ON sep.id = rp.sport_event_participant_id
WHERE rp.entry_id = dph.entry_id
  AND sep.participant_id = dph.participant_id
  AND rp.draft_pick_number = dph.pick_number;

ALTER TABLE "draft_pick_histories"
  ALTER COLUMN "roster_pick_id" SET NOT NULL;

ALTER TABLE "draft_pick_histories"
  DROP COLUMN "participant_id",
  DROP COLUMN "picked_at";

ALTER INDEX "draft_picks_draft_session_id_idx"
  RENAME TO "draft_pick_histories_draft_session_id_idx";

ALTER INDEX "draft_picks_draft_session_id_pick_number_key"
  RENAME TO "draft_pick_histories_draft_session_id_pick_number_key";

ALTER TABLE "draft_pick_histories"
  ADD CONSTRAINT "draft_pick_histories_roster_pick_id_fkey"
  FOREIGN KEY ("roster_pick_id") REFERENCES "roster_picks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
