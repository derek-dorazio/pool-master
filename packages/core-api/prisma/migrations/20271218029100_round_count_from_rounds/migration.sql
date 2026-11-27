-- An event's round count is the count of its Round rows (#2008), read with it and never stored;
-- an unplayed golf round is scored by its scoring definition's to-par setting, never from a par.
ALTER TABLE "sport_events" DROP COLUMN "rounds", DROP COLUMN "rounds_par";
