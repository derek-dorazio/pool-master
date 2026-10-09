-- #544 — the two pick columns named after drafting are written by every selection type, so they
-- take the selection vocabulary. A rename only: no data moves.
--   draft_round       → lineup_slot    (the pick's position in its entry's lineup)
--   draft_pick_number → pick_sequence  (the contest-wide order the pick was recorded in)
ALTER TABLE "contest_entry_picks" RENAME COLUMN "draft_round" TO "lineup_slot";
ALTER TABLE "contest_entry_picks" RENAME COLUMN "draft_pick_number" TO "pick_sequence";
